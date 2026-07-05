// Open Library search - free, no API key (port of src/openlibrary.js).
// Open Library can be slow or hang; cap each lookup at 12s so the search UI
// fails gracefully instead of spinning forever. Only the fields the mapper
// reads are requested (dropping `editions` also speeds up the response).

import Foundation

enum OpenLibraryError: LocalizedError {
    case timedOut
    case lookupFailed

    var errorDescription: String? {
        switch self {
        case .timedOut: return "Open Library timed out"
        case .lookupFailed: return "Open Library lookup failed"
        }
    }
}

enum OpenLibraryAPI {
    private static let searchBase = "https://openlibrary.org/search.json"
    private static let timeout: TimeInterval = 12

    private struct SearchResponse: Decodable {
        let docs: [Doc]?

        struct Doc: Decodable {
            let key: String?
            let title: String?
            let authorName: [String]?
            let firstPublishYear: Int?
            let coverI: Int?
            let numberOfPagesMedian: Int?

            enum CodingKeys: String, CodingKey {
                case key, title
                case authorName = "author_name"
                case firstPublishYear = "first_publish_year"
                case coverI = "cover_i"
                case numberOfPagesMedian = "number_of_pages_median"
            }
        }
    }

    static func searchBooks(query: String) async throws -> [OpenLibraryBook] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }

        var components = URLComponents(string: searchBase)!
        components.queryItems = [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "limit", value: "8"),
            URLQueryItem(name: "fields",
                         value: "key,title,author_name,first_publish_year,cover_i,number_of_pages_median"),
        ]

        var request = URLRequest(url: components.url!)
        request.timeoutInterval = timeout

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw OpenLibraryError.timedOut
        } catch {
            throw OpenLibraryError.lookupFailed
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OpenLibraryError.lookupFailed
        }

        let decoded: SearchResponse
        do {
            decoded = try JSONDecoder().decode(SearchResponse.self, from: data)
        } catch {
            throw OpenLibraryError.lookupFailed
        }

        return (decoded.docs ?? []).compactMap { d in
            guard let key = d.key, let title = d.title else { return nil }
            let author = (d.authorName ?? []).prefix(2).joined(separator: ", ")
            return OpenLibraryBook(
                openLibraryId: key,
                title: title,
                author: author.isEmpty ? nil : author,
                year: d.firstPublishYear,
                pageCount: d.numberOfPagesMedian,
                coverUrl: d.coverI.map { "https://covers.openlibrary.org/b/id/\($0)-M.jpg" }
            )
        }
    }
}
