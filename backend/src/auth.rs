use axum::{Json, extract::State, response::IntoResponse};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use time::Duration as CookieDuration;

use crate::{AppState, config::Config, error::AppError};

const COOKIE_NAME: &str = "auth";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user_id: String,
    pub token: String,
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<LoginRequest>,
) -> Result<(CookieJar, Json<LoginResponse>), AppError> {
    // Stub user auth: accept demo@local / demo123
    if body.email != "demo@local" || body.password != "demo123" {
        return Err(AppError::BadRequest("invalid credentials".into()));
    }

    let exp = (Utc::now() + Duration::hours(24)).timestamp() as usize;
    let claims = Claims {
        sub: "demo-user".into(),
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("token encode error: {e}")))?;

    let cookie = Cookie::build((COOKIE_NAME, token.clone()))
        .http_only(true)
        .path("/")
        .same_site(SameSite::Lax)
        .max_age(CookieDuration::hours(24))
        .build();

    Ok((
        jar.add(cookie),
        Json(LoginResponse {
            user_id: claims.sub,
            token,
        }),
    ))
}

pub async fn logout(jar: CookieJar) -> impl IntoResponse {
    let cleared = jar.remove(Cookie::from(COOKIE_NAME));
    (cleared, ())
}

pub fn validate_token(config: &Config, jar: &CookieJar) -> Option<Claims> {
    let token = jar.get(COOKIE_NAME)?.value().to_string();
    decode::<Claims>(
        &token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims)
}
