// Generates the 1024x1024 App Store icon master: a granny-square patch
// (parchment ground, nested yarn-colored borders) with the book-stack mark.
// Run from ios/:  swift Scripts/generate-icon.swift <output.png>
// Re-run any time; the asset catalog references the emitted PNG.

import AppKit
import Foundation

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "ReadingRoom/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"

func color(_ hex: UInt32) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: 1
    )
}

let bg = color(0xe8e3d9)        // --surface
let bark = color(0x483828)      // --yarn-bark
let sage = color(0x7a9068)      // --yarn-sage
let rust = color(0xa05838)      // --yarn-rust
let ochre = color(0xb8a058)     // --yarn-ochre

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else {
    fatalError("could not create bitmap")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Parchment ground (iOS masks the corners itself; fill the full square).
bg.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()

// Nested granny-square borders, worked outside-in like rounds of crochet.
struct Round {
    let inset: CGFloat
    let width: CGFloat
    let color: NSColor
}
let rounds: [Round] = [
    Round(inset: 34, width: 30, color: bark),
    Round(inset: 88, width: 26, color: sage),
    Round(inset: 138, width: 22, color: rust),
    Round(inset: 184, width: 18, color: ochre),
]
for round in rounds {
    let rect = NSRect(x: round.inset, y: round.inset,
                      width: size - 2 * round.inset, height: size - 2 * round.inset)
    let path = NSBezierPath(roundedRect: rect, xRadius: 56, yRadius: 56)
    path.lineWidth = round.width
    round.color.setStroke()
    path.stroke()
}

// Corner "stitches": a small ochre dot at each inner corner, like tied-off yarn.
let dotR: CGFloat = 26
for (dx, dy) in [(1, 1), (1, -1), (-1, 1), (-1, -1)] {
    let cx = size / 2 + CGFloat(dx) * (size / 2 - 250)
    let cy = size / 2 + CGFloat(dy) * (size / 2 - 250)
    ochre.setFill()
    NSBezierPath(ovalIn: NSRect(x: cx - dotR, y: cy - dotR,
                                width: dotR * 2, height: dotR * 2)).fill()
}

// The book stack mark, centered.
let mark = "\u{1F4DA}" as NSString
let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "Apple Color Emoji", size: 430) ?? NSFont.systemFont(ofSize: 430),
]
let markSize = mark.size(withAttributes: attrs)
mark.draw(at: NSPoint(x: (size - markSize.width) / 2,
                      y: (size - markSize.height) / 2),
          withAttributes: attrs)

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("could not encode png")
}
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
