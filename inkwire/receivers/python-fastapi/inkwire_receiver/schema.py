import re
from typing import Literal, Optional
from pydantic import BaseModel, Field, EmailStr, AnyUrl, ValidationError
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
class Author(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
class PostInput(BaseModel):
    model_config = {"extra": "forbid"}
    external_id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=512)
    markdown: str = Field(min_length=1)
    slug: Optional[str] = Field(default=None, max_length=255)
    excerpt: Optional[str] = Field(default=None, max_length=1024)
    tags: Optional[list[str]] = None
    cover_image_url: Optional[AnyUrl] = None
    canonical_url: Optional[AnyUrl] = None
    author: Optional[Author] = None
    status: Literal["draft", "published"] = "draft"
    published_at: Optional[str] = None
    def validate_slug(self):
        if self.slug is not None and not SLUG.match(self.slug):
            raise ValueError("slug must be kebab-case")
