package io.acme.api
import io.acme.model.Article
class ArticleApi {
    @GetMapping("/articles/{slug}")
    fun get(slug: String): Article = Article(slug)
}
