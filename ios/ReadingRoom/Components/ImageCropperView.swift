// Circular / rounded-square image cropper (native port of imageCropper.js).
// Lets the user pan and pinch-zoom to frame a photo, then BAKES the framing
// into a 512x512 JPEG so display code stays unchanged (avatars are circles,
// club icons rounded squares - both just show the square we emit).
//
// Usage:
//   .fullScreenCover(item: $pendingCrop) { pending in
//       ImageCropperView(image: pending.image, shape: .circle) { jpegData in ... }
//   }
// Calls onDone with JPEG data, or nil if the user cancels.

import SwiftUI
import UIKit

struct ImageCropperView: View {
    enum Shape {
        case circle, rounded
    }

    let image: UIImage
    var shape: Shape = .circle
    let onDone: (Data?) -> Void

    @Environment(\.dismiss) private var dismiss

    private static let viewport: CGFloat = 280
    private static let output: CGFloat = 512
    private static let maxZoom: CGFloat = 4

    // zoom is a multiplier over the "cover" scale (1 = image just fills the
    // viewport); offsets are the image's top-left within the viewport (<= 0).
    @State private var zoom: CGFloat = 1
    @State private var offX: CGFloat = 0
    @State private var offY: CGFloat = 0
    @GestureState private var dragDelta: CGSize = .zero
    @GestureState private var pinchDelta: CGFloat = 1

    private var imageSize: CGSize { image.size }

    private var baseScale: CGFloat {
        max(Self.viewport / imageSize.width, Self.viewport / imageSize.height)
    }

    private func effScale(_ zoom: CGFloat) -> CGFloat { baseScale * zoom }

    var body: some View {
        VStack(spacing: 18) {
            Text("Frame your photo")
                .font(Theme.displayBold(22))
                .foregroundStyle(Theme.textPrimary)
            Text("Drag to reposition \u{00B7} pinch to zoom")
                .font(Theme.monoFont(12))
                .foregroundStyle(Theme.textMuted)

            stage

            HStack(spacing: 10) {
                Text("\u{2212}").font(Theme.monoMedium(16)).foregroundStyle(Theme.textMuted)
                Slider(value: zoomBinding, in: 1...Self.maxZoom)
                    .tint(Theme.yarnSage)
                Text("\u{FF0B}").font(Theme.monoMedium(16)).foregroundStyle(Theme.textMuted)
            }
            .padding(.horizontal, 24)

            HStack(spacing: 14) {
                Button("Cancel") {
                    onDone(nil)
                    dismiss()
                }
                .buttonStyle(.ghost)
                Button("Save photo") {
                    onDone(bake())
                    dismiss()
                }
                .buttonStyle(.primary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
    }

    // MARK: stage

    private var stage: some View {
        let liveZoom = clampZoom(zoom * pinchDelta)
        let scale = effScale(liveZoom)
        let (x, y) = clampedOffsets(
            offX + dragDelta.width,
            offY + dragDelta.height,
            zoom: liveZoom
        )

        return ZStack(alignment: .topLeading) {
            Image(uiImage: image)
                .resizable()
                .frame(width: imageSize.width * scale, height: imageSize.height * scale)
                .offset(x: x, y: y)
        }
        .frame(width: Self.viewport, height: Self.viewport, alignment: .topLeading)
        .clipped()
        .overlay(maskOutline)
        .contentShape(Rectangle())
        .gesture(dragGesture.simultaneously(with: pinchGesture))
    }

    private var maskOutline: some View {
        RoundedRectangle(cornerRadius: shape == .circle
                         ? Self.viewport / 2
                         : Self.viewport * 0.16)
            .stroke(Theme.textPrimary.opacity(0.85), lineWidth: 2)
            .background(
                // Dim everything outside the crop shape.
                RoundedRectangle(cornerRadius: shape == .circle
                                 ? Self.viewport / 2
                                 : Self.viewport * 0.16)
                    .fill(Color.clear)
            )
    }

    // MARK: gestures

    private var dragGesture: some Gesture {
        DragGesture()
            .updating($dragDelta) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let (x, y) = clampedOffsets(offX + value.translation.width,
                                            offY + value.translation.height,
                                            zoom: zoom)
                offX = x
                offY = y
            }
    }

    private var pinchGesture: some Gesture {
        MagnificationGesture()
            .updating($pinchDelta) { value, state, _ in
                state = value
            }
            .onEnded { value in
                applyZoom(zoom * value)
            }
    }

    private var zoomBinding: Binding<CGFloat> {
        Binding(get: { zoom }, set: { applyZoom($0) })
    }

    // Zoom while keeping the viewport center anchored on the same image point
    // (port of imageCropper.js setZoom).
    private func applyZoom(_ next: CGFloat) {
        let clamped = clampZoom(next)
        let old = effScale(zoom)
        let cx = (Self.viewport / 2 - offX) / old
        let cy = (Self.viewport / 2 - offY) / old
        zoom = clamped
        let new = effScale(clamped)
        let (x, y) = clampedOffsets(Self.viewport / 2 - cx * new,
                                    Self.viewport / 2 - cy * new,
                                    zoom: clamped)
        offX = x
        offY = y
    }

    private func clampZoom(_ z: CGFloat) -> CGFloat {
        min(Self.maxZoom, max(1, z))
    }

    // The image must always cover the viewport: top-left <= 0, bottom-right
    // past the viewport edge (port of imageCropper.js clamp()).
    private func clampedOffsets(_ x: CGFloat, _ y: CGFloat, zoom: CGFloat) -> (CGFloat, CGFloat) {
        let w = imageSize.width * effScale(zoom)
        let h = imageSize.height * effScale(zoom)
        return (
            min(0, max(Self.viewport - w, x)),
            min(0, max(Self.viewport - h, y))
        )
    }

    // MARK: bake

    // Renders the framed square at 512x512 and returns JPEG data (quality 0.9,
    // flattened on white like the web cropper).
    private func bake() -> Data? {
        let f = Self.output / Self.viewport
        let scale = effScale(zoom)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: Self.output, height: Self.output),
            format: format
        )
        let baked = renderer.image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: Self.output, height: Self.output))
            image.draw(in: CGRect(
                x: offX * f,
                y: offY * f,
                width: imageSize.width * scale * f,
                height: imageSize.height * scale * f
            ))
        }
        return baked.jpegData(compressionQuality: 0.9)
    }
}

// Little identifiable wrapper so a picked image can drive a fullScreenCover.
struct PendingCrop: Identifiable {
    let id = UUID()
    let image: UIImage
}
