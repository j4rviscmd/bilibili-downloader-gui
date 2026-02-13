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
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `mid` - User's member ID (mid)
///
/// # Returns
///
/// List of favorite folders with metadata.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable
/// - API request fails
/// - Response parsing fails
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

    eprintln!("[DEBUG] Favorite folders raw response: {}", &raw_text);

    let response: FavoriteFolderListApiResponse = serde_json::from_str(&raw_text)
        .map_err(|e| format!("Failed to parse favorite folders response: {e}\nRaw: {raw_text}"))?;

    if response.code != 0 {
        return Err(format!(
            "API error (code {}): {}",
            response.code, response.message
        ));
    }

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
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `media_id` - Favorite folder ID
/// * `page_num` - Page number (1-indexed)
/// * `page_size` - Number of items per page (max 20)
///
/// # Returns
///
/// Paginated list of videos with metadata.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable
/// - API request fails
/// - Response parsing fails
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
            upper: FavoriteVideoUpperDto {
                mid: m.upper.mid,
                name: m.upper.name,
                face: m.upper.face,
            },
            attr: m.attr,
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
