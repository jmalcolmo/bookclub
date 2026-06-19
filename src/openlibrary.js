// Open Library search — free, no API key. Used for book auto-lookup.

const SEARCH = "https://openlibrary.org/search.json";

export async function searchBooks(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&limit=8&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,editions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Open Library lookup failed");
  const data = await res.json();
  return (data.docs || []).map((d) => ({
    open_library_id: d.key,                 // e.g. "/works/OL123W"
    title: d.title,
    author: (d.author_name || []).slice(0, 2).join(", "),
    year: d.first_publish_year,
    page_count: d.number_of_pages_median || null,
    cover_url: d.cover_i
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
      : null,
  }));
}
