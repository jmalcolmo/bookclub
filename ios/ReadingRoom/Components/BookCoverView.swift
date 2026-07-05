// Book cover thumbnails (port of the .book-cover img / .book-cover-blank
// pattern): the Open Library cover when there is one, else a parchment
// placeholder with a book glyph.

import SwiftUI

struct BookCoverView: View {
    let coverUrl: String?
    var width: CGFloat = 56

    private var height: CGFloat { width * 1.5 }

    var body: some View {
        Group {
            if let coverUrl, let url = URL(string: coverUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        blank
                    }
                }
            } else {
                blank
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Theme.shadowInk.opacity(0.25), lineWidth: 1)
        )
        .compositingGroup()
        .shadow(color: Theme.shadowInk.opacity(0.2), radius: 0, x: 2, y: 2)
    }

    private var blank: some View {
        ZStack {
            Theme.surface2
            Text("\u{1F4D6}")
                .font(.system(size: width * 0.42))
        }
    }
}
