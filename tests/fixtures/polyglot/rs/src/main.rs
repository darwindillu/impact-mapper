use crate::models::article::Article;
mod models;
#[get("/articles/{id}/comments")]
async fn list_comments() -> String { "Comment saved".to_string() }
fn routes() { Router::new().route("/tags", get(list_tags)); }
