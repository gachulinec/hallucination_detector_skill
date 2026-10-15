import { describe, expect, test } from "vitest";
import {
  createPageFetcher,
  extractReadableText,
  selectPassages,
} from "../src/utils/page-fetcher.js";

const FILLER =
  "The committee reviewed the annual figures in detail and discussed the methodology used by the statistical office. ";

const ARTICLE_HTML = `<!doctype html><html><head><title>Report</title>
<script>var tracking = "should not appear";</script></head>
<body><nav>Home | About | Contact</nav>
<article><h1>Annual report</h1>
<p>${FILLER.repeat(4)}</p>
<p>Revenue grew by 35 percent in 2023 according to the audited statements.</p>
<p>${FILLER.repeat(4)}</p></article>
<footer>Copyright</footer></body></html>`;

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}


describe("extractReadableText", () => {
  test("keeps the article text and drops scripts", () => {
    const text = extractReadableText(ARTICLE_HTML);

    expect(text).toContain("Revenue grew by 35 percent in 2023");
    expect(text).not.toContain("should not appear");
  });
});

describe("selectPassages", () => {
  test("ranks the passage that contains the claim's number first", () => {
    const text =
      FILLER.repeat(10) +
      "Revenue grew by 20 percent in 2022. " +
      FILLER.repeat(10) +
      "Revenue grew by 35 percent in 2023. " +
      FILLER.repeat(10);

    const passages = selectPassages(text, "Revenue grew by 35% in 2023", 2, 300);

    expect(passages[0]).toContain("35 percent in 2023");
  });

  test("returns the whole text when it is shorter than one passage", () => {
    expect(selectPassages("Short page.", "claim", 3, 800)).toEqual(["Short page."]);
  });
});

describe("createPageFetcher", () => {
  test("returns the readable text of an HTML page", async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(ARTICLE_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
    );
    const fetcher = createPageFetcher({ fetchImpl });

    const result = await fetcher.fetchPageText("https://example.com/report");

    expect(result.method).toBe("direct");
    expect(result.text).toContain("35 percent");
  });

  test("reports a failed request with its status", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("Forbidden", { status: 403 }));
    const fetcher = createPageFetcher({ fetchImpl });

    const result = await fetcher.fetchPageText("https://example.com/blocked");

    expect(result).toMatchObject({ text: null, method: "none" });
    expect(result.reason).toMatch(/403/);
  });

  test("does not try to read a PDF as HTML", async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } })
    );
    const fetcher = createPageFetcher({ fetchImpl });

    const result = await fetcher.fetchPageText("https://example.com/report.pdf");

    expect(result.text).toBeNull();
    expect(result.reason).toMatch(/application\/pdf/);
  });

  test("reports a page with too little text, as rendered by JavaScript", async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response("<html><body><div id=app></div></body></html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const fetcher = createPageFetcher({ fetchImpl });

    const result = await fetcher.fetchPageText("https://example.com/app");

    expect(result.text).toBeNull();
    expect(result.reason).toMatch(/JavaScript/);
  });
});
