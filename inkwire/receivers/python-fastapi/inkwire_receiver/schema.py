import re
from datetime import datetime
from typing import Annotated, Literal, Optional
from pydantic import BaseModel, Field, EmailStr, ValidationError, field_validator
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
HTTP_URL = re.compile(r"^https?://")
DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
class Author(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = None
    email: Optional[EmailStr] = None
class PostInput(BaseModel):
    model_config = {"extra": "forbid"}
    external_id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=512)
    markdown: str = Field(min_length=1)
    slug: Optional[str] = Field(default=None, max_length=255)
    excerpt: Optional[str] = Field(default=None, max_length=1024)
    tags: Optional[list[Annotated[str, Field(max_length=64)]]] = Field(default=None, max_length=50)
    cover_image_url: Optional[str] = None
    canonical_url: Optional[str] = None
    author: Optional[Author] = None
    status: Literal["draft", "published"] = "draft"
    published_at: Optional[str] = None

    @field_validator("cover_image_url", "canonical_url")
    @classmethod
    def check_http_url(cls, v):
        if v is None:
            return v
        if not HTTP_URL.match(v):
            raise ValueError("must be an http(s) URL")
        return v

    @field_validator("published_at")
    @classmethod
    def check_published_at(cls, v):
        if v is None:
            return v
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("published_at must be an ISO 8601 date-time string")
        if not DATE_TIME.match(v):
            raise ValueError("published_at must be an RFC3339 date-time with a time component and Z/offset")
        return v

    def validate_slug(self):
        if self.slug is not None and not SLUG.match(self.slug):
            raise ValueError("slug must be kebab-case")
