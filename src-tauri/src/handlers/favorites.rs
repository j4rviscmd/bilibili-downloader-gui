//! Bilibili Favorites API Integration Module
//!
//! This module handles interactions with Bilibili's favorite folder APIs:
//!
//! ## Main Features
//!
//! - **Folder List Retrieval**: Fetches all favorite folders for a user
//! - **Folder Contents Retrieval**: Fetches videos within a specific folder
//!
//! ## API Endpoints
//!
//! - Folder list: `GET https://api.bilibili.com/x/v3/fav/folder/created/list-all`
//! - Folder contents: `GET https://api.bilibili.com/x/v3/fav/resource/list`

use serde_json;
use tauri::AppHandle;

use crate::handlers::bilibili::{build_cookie_header_from_cache, BiliApi};
use crate::models::bilibili_api::{FavoriteFolderListApiResponse, FavoriteResourceListApiResponse};
use crate::models::frontend_dto::{
    FavoriteFolder, FavoriteFolderUpperDto, FavoriteVideo, FavoriteVideoListResponse,
    FavoriteVideoUpperDto,
};

/// Fetches all favorite folders for the logged-in user.
///
/// This function retrieves the user's collection of favorite folders from Bilibili's API,
/// converting the raw API response into the frontend-friendly DTO format.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `mid` - User's member ID (mid) - identifies which user's folders to fetch
///
/// # Returns
///
/// `Vec<FavoriteFolder>` - A list of favorite folders containing:
/// - `id`: Unique folder identifier
/// - `title`: Display name of the folder
/// - `cover`: Cover image URL
/// - `media_count`: Number of videos in the folder
/// - `upper`: Optional creator information (for public folders)
///
/// # Errors
///
/// Returns an error if:
/// - `CookieMissing`: Authentication cookies are not available in cache
/// - `ApiRequestFailed`: Network request to Bilibili API fails
/// - `ApiResponseParseFailed`: JSON response cannot be parsed
/// - `ApiErrorCode`: Bilibili API returns non-zero error code with message
///
/// # Examples
///
/// Why: needs a live AppHandle with authenticated Bilibili API access; doctests run
/// in CI (rust-test job) and must stay hermetic
/// ```ignore
/// use tauri::AppHandle;
///
/// // Fetch favorite folders for user with mid = 123456
/// let folders = fetch_favorite_folders(&app, 123456).await?;
/// println!("Found {} favorite folders", folders.len());
/// ```
pub async fn fetch_favorite_folders(
    app: &AppHandle,
    mid: i64,
) -> Result<Vec<FavoriteFolder>, String> {
    log::info!(
        "[BE] fetch_favorite_folders: requesting folders for mid={}",
        mid
    );
    let cookie_header = build_cookie_header_from_cache(app)?;

    // Why: BiliApi::get status-checks the response, which this module's fetchers
    // previously skipped; a 429/5xx used to fall through to the JSON parse below
    // and surface as a parse error instead of an ERR:: code the frontend can map
    // (src/shared/lib/mapBackendError.ts).
    let api = BiliApi::from_cookie_header(cookie_header)?;
    fetch_favorite_folders_via(&api, mid).await
}

/// Transport-injectable variant of [`fetch_favorite_folders`] (test seam:
/// wiremock tests pass a BiliApi whose base URL points at a local server).
async fn fetch_favorite_folders_via(
    api: &BiliApi,
    mid: i64,
) -> Result<Vec<FavoriteFolder>, String> {
    let raw_text = api
        .get(&format!(
            "/x/v3/fav/folder/created/list-all?up_mid={}&type=2",
            mid
        ))
        .await?
        .text()
        .await
        .map_err(|e| format!("Failed to read favorite folders response: {e}"))?;

    let response: FavoriteFolderListApiResponse = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Failed to parse favorite folders response: {e}\nRaw: {raw_text}"))?;

    if response.code == -101 {
        return Err("ERR::UNAUTHORIZED".into());
    }
    if response.code != 0 {
        return Err(format!(
            "API error (code {}): {}",
            response.code, response.message
        ));
    }

    // Convert API response to frontend DTO
    // Safely extract folder list with option chaining, default to empty if missing
    let folders = response
        .data
        .and_then(|d| d.list)
        .unwrap_or_default()
        .into_iter()
        .map(|f| FavoriteFolder {
            id: f.id,
            title: f.title,
            cover: f.cover,
            media_count: f.media_count,
            // Convert optional creator info to DTO
            upper: f.upper.map(|u| FavoriteFolderUpperDto {
                mid: u.mid,
                name: u.name,
                face: u.face,
            }),
        })
        .collect();

    Ok(folders)
}

/// Fetches videos from a specific favorite folder with pagination.
///
/// This function retrieves videos from a specific favorite folder, supporting pagination
/// to handle large collections. The API supports up to 20 items per page.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `media_id` - Favorite folder ID (identifies which folder to fetch videos from)
/// * `page_num` - Page number (1-indexed, starts from 1)
/// * `page_size` - Number of items per page (maximum 20, Bilibili API limitation)
///
/// # Returns
///
/// `FavoriteVideoListResponse` containing:
/// - `videos`: List of video metadata
/// - `has_more`: Boolean indicating if more pages are available
/// - `total_count`: Total number of videos in the folder
///
/// Each video in the list includes:
/// - Basic info: `id`, `bvid`, `title`, `cover`, `duration`
/// - Creator info: `upper` (mid, name, face)
/// - Engagement metrics: `play_count`, `collect_count`
/// - Additional metadata: `page`, `attr`, `link`
///
/// # Errors
///
/// Returns an error if:
/// - `CookieMissing`: Authentication cookies are not available in cache
/// - `ApiRequestFailed`: Network request to Bilibili API fails
/// - `ApiResponseParseFailed`: JSON response cannot be parsed
/// - `ApiErrorCode`: Bilibili API returns non-zero error code with message
/// - `NoDataInResponse`: API response contains no data field
///
/// # Examples
///
/// Why: needs a live AppHandle with authenticated Bilibili API access; doctests run
/// in CI (rust-test job) and must stay hermetic
/// ```ignore
/// use tauri::AppHandle;
///
/// // Fetch first page (10 items) from folder with ID 98765
/// let response = fetch_favorite_videos(&app, 98765, 1, 10).await?;
/// println!("Retrieved {} videos, has_more: {}", response.videos.len(), response.has_more);
///
/// // Fetch next page if available
/// if response.has_more {
///     let next_page = fetch_favorite_videos(&app, 98765, 2, 10).await?;
/// }
/// ```
pub async fn fetch_favorite_videos(
    app: &AppHandle,
    media_id: i64,
    page_num: i32,
    page_size: i32,
) -> Result<FavoriteVideoListResponse, String> {
    log::info!(
        "[BE] fetch_favorite_videos: requesting media_id={}, page={}, size={}",
        media_id,
        page_num,
        page_size
    );
    let cookie_header = build_cookie_header_from_cache(app)?;

    // Why: BiliApi::get status-checks the response, which this module's fetchers
    // previously skipped; a 429/5xx used to fall through to the JSON parse below
    // and surface as a parse error instead of an ERR:: code the frontend can map
    // (src/shared/lib/mapBackendError.ts).
    let api = BiliApi::from_cookie_header(cookie_header)?;
    fetch_favorite_videos_via(&api, media_id, page_num, page_size).await
}

/// Transport-injectable variant of [`fetch_favorite_videos`] (test seam:
/// wiremock tests pass a BiliApi whose base URL points at a local server).
async fn fetch_favorite_videos_via(
    api: &BiliApi,
    media_id: i64,
    page_num: i32,
    page_size: i32,
) -> Result<FavoriteVideoListResponse, String> {
    let response = api
        .get(&format!(
            "/x/v3/fav/resource/list?media_id={}&pn={}&ps={}&order=mtime&type=0&platform=web",
            media_id, page_num, page_size
        ))
        .await?
        .json::<FavoriteResourceListApiResponse>()
        .await
        .map_err(|e| format!("Failed to parse favorite videos response: {e}"))?;

    if response.code == -101 {
        return Err("ERR::UNAUTHORIZED".into());
    }
    if response.code != 0 {
        return Err(format!(
            "API error (code {}): {}",
            response.code, response.message
        ));
    }

    let data = response.data.ok_or("No data in response")?;
    let total_count = data.info.media_count;

    // Convert API response to frontend DTO
    // Handle optional media list safely, map each media item to video DTO
    let videos = data
        .medias
        .unwrap_or_default()
        .into_iter()
        .map(|m| FavoriteVideo {
            id: m.id,
            bvid: m.bvid,
            title: m.title,
            cover: m.cover,
            duration: m.duration,
            page: m.page,
            // Creator info is guaranteed in video response
            upper: FavoriteVideoUpperDto {
                mid: m.upper.mid,
                name: m.upper.name,
                face: m.upper.face,
            },
            attr: m.attr,
            // Extract engagement metrics from nested structure
            play_count: m.cnt_info.play,
            collect_count: m.cnt_info.collect,
            link: m.link,
        })
        .collect();

    Ok(FavoriteVideoListResponse {
        videos,
        has_more: data.has_more,
        total_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::bilibili::{build_client, BiliApi};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn api_at(base: &str) -> BiliApi {
        BiliApi::new(build_client().unwrap(), base, "SESSDATA=x")
    }

    #[tokio::test]
    async fn folders_maps_api_response_to_dto() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/folder/created/list-all"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": 0,
                "message": "0",
                "data": {
                    "count": 2,
                    "list": [
                        {
                            "id": 11, "fid": 11, "mid": 1, "attr": 0,
                            "title": "Default", "media_count": 3,
                            "upper": {"mid": 1, "name": "u1", "face": "https://face/1"}
                        },
                        { "id": 22, "fid": 22, "mid": 1, "attr": 0, "title": "NoUpper", "media_count": 0 }
                    ]
                }
            })))
            .mount(&server)
            .await;

        let folders = fetch_favorite_folders_via(&api_at(&server.uri()), 1)
            .await
            .unwrap();
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].id, 11);
        assert_eq!(folders[0].title, "Default");
        assert_eq!(folders[0].media_count, 3);
        let upper = folders[0].upper.as_ref().expect("upper present");
        assert_eq!(upper.mid, 1);
        assert_eq!(upper.name, "u1");
        assert!(folders[1].upper.is_none(), "missing upper maps to None");
    }

    #[tokio::test]
    async fn folders_without_data_list_returns_empty() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/folder/created/list-all"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": 0, "message": "0"
            })))
            .mount(&server)
            .await;

        let folders = fetch_favorite_folders_via(&api_at(&server.uri()), 1)
            .await
            .unwrap();
        assert!(
            folders.is_empty(),
            "missing data.list must map to empty vec"
        );
    }

    #[tokio::test]
    async fn folders_unauthorized_maps_to_err_code() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/folder/created/list-all"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": -101, "message": "账号未登录"
            })))
            .mount(&server)
            .await;

        let err = fetch_favorite_folders_via(&api_at(&server.uri()), 1)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::UNAUTHORIZED");
    }

    #[tokio::test]
    async fn folders_nonzero_code_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/folder/created/list-all"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": -400, "message": "请求错误"
            })))
            .mount(&server)
            .await;

        let err = fetch_favorite_folders_via(&api_at(&server.uri()), 1)
            .await
            .unwrap_err();
        assert!(err.contains("API error (code -400)"), "got: {err}");
    }

    #[tokio::test]
    async fn videos_maps_api_response_to_dto() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/resource/list"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": 0,
                "message": "0",
                "data": {
                    "has_more": true,
                    "info": {"id": 98765, "fid": 98765, "mid": 1, "attr": 0, "title": "Fav", "cover": "https://c/f", "upper": {"mid": 1, "name": "u1", "face": "https://face/1"}, "cover_type": 0, "cnt_info": {"collect": 0, "play": 0, "thumb_up": 0, "share": 0}, "type": 0, "intro": "", "ctime": 0, "mtime": 0, "state": 0, "fav_state": 0, "media_count": 7},
                    "medias": [
                        {
                            "id": 5, "type": 2, "title": "Video", "cover": "https://c/1",
                            "intro": "", "page": 1, "duration": 60,
                            "upper": {"mid": 2, "name": "upper2", "face": "https://face/2"},
                            "attr": 0,
                            "cnt_info": {"collect": 10, "play": 100, "danmaku": 5},
                            "link": "https://b23.tv/x",
                            "ctime": 0, "pubtime": 0, "fav_time": 0,
                            "bv_id": "BV1xx", "bvid": "BV1xx"
                        }
                    ]
                }
            })))
            .mount(&server)
            .await;

        let resp = fetch_favorite_videos_via(&api_at(&server.uri()), 98765, 1, 20)
            .await
            .unwrap();
        assert!(resp.has_more);
        assert_eq!(resp.total_count, 7);
        assert_eq!(resp.videos.len(), 1);
        let v = &resp.videos[0];
        assert_eq!(v.bvid, "BV1xx");
        assert_eq!(v.play_count, 100);
        assert_eq!(v.collect_count, 10);
        assert_eq!(v.upper.name, "upper2");
    }

    #[tokio::test]
    async fn videos_missing_data_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/resource/list"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": 0, "message": "0"
            })))
            .mount(&server)
            .await;

        let err = fetch_favorite_videos_via(&api_at(&server.uri()), 1, 1, 20)
            .await
            .unwrap_err();
        assert_eq!(err, "No data in response");
    }

    #[tokio::test]
    async fn videos_unauthorized_maps_to_err_code() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x/v3/fav/resource/list"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "code": -101, "message": "账号未登录"
            })))
            .mount(&server)
            .await;

        let err = fetch_favorite_videos_via(&api_at(&server.uri()), 1, 1, 20)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::UNAUTHORIZED");
    }
}
