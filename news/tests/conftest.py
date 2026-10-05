import httpx
import pytest

from worldview_news.db import connect, init_db

RSS = """<?xml version="1.0"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss"><channel><title>{title}</title>
{items}
</channel></rss>"""

ITEM = """<item><title>{title}</title><link>{link}</link><guid>{guid}</guid>
<description>{summary}</description><pubDate>{date}</pubDate>{extra}</item>"""


def rss(title="Test feed", items=()):
    body = "".join(
        ITEM.format(title=i["title"], link=i.get("link", ""), guid=i.get("guid", i.get("link", i["title"])),
                    summary=i.get("summary", ""), date=i.get("date", "Mon, 05 Oct 2026 12:00:00 GMT"),
                    extra=i.get("extra", ""))
        for i in items
    )
    return RSS.format(title=title, items=body)


@pytest.fixture
def conn():
    c = connect(":memory:")
    init_db(c)
    yield c
    c.close()


def mock_client(routes: dict[str, str | int]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        body = routes.get(str(request.url))
        if body is None:
            return httpx.Response(404)
        if isinstance(body, int):
            return httpx.Response(body)
        return httpx.Response(200, text=body, headers={"ETag": '"v1"'})

    return httpx.Client(transport=httpx.MockTransport(handler))
