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

use reqwest::header;
use serde_json;
use tauri::AppHandle;

use crate::constants::REFERER;
use crate::handlers::bilibili::{build_client, build_cookie_header_from_cache};
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
/// ```rust
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
    let cookie_header = build_cookie_header_from_cache(app)?;

    let client = build_client()?;
    let url = format!(
        "https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid={}&type=2",
        mid
    );

    let raw_text = client
        .get(&url)
        .header(header::COOKIE, &cookie_header)
        .header(header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch favorite folders: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read favorite folders response: {e}"))?;

    let response: FavoriteFolderListApiResponse = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Failed to parse favorite folders response: {e}\nRaw: {raw_text}"))?;

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
/// ```rust
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
    let cookie_header = build_cookie_header_from_cache(app)?;

    let client = build_client()?;
    let url = format!(
        "https://api.bilibili.com/x/v3/fav/resource/list?media_id={}&pn={}&ps={}&order=mtime&type=0&platform=web",
        media_id, page_num, page_size
    );

    let response = client
        .get(&url)
        .header(header::COOKIE, &cookie_header)
        .header(header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch favorite videos: {e}"))?
        .json::<FavoriteResourceListApiResponse>()
        .await
        .map_err(|e| format!("Failed to parse favorite videos response: {e}"))?;

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
