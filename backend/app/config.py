from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_api_key: str = ""
    muse_spark_model: str = "muse-spark-1.3"
    muse_voice_model: str = "muse-voice-transcribe-1.0"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    cors_origins: str = "http://localhost:3000"

    @property
    def muse_enabled(self) -> bool:
        return bool(self.model_api_key.strip())

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
