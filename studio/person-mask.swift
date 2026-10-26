// Person segmentation using macOS Vision. Frames and masks stay on this machine.
import Foundation
import Vision
import AppKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else { fatalError("person-mask <frames> <masks>") }
let frames = URL(fileURLWithPath: CommandLine.arguments[1])
let masks = URL(fileURLWithPath: CommandLine.arguments[2])
let files = try FileManager.default.contentsOfDirectory(at: frames, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "png" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
let context = CIContext()
let request = VNGeneratePersonSegmentationRequest()
// This is an offline render, so favour detailed hair/shoulder edges over
// the lower-latency balanced masks used for a live camera preview.
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
// Keep the request and handler alive for the ordered video sequence. Do not
// blend masks across frames: that leaves a trailing edge when the person moves.
let handler = VNSequenceRequestHandler()
for (index, url) in files.enumerated() {
    try autoreleasepool {
        try handler.perform([request], onImageURL: url, orientation: .up)
        guard let buffer = request.results?.first?.pixelBuffer else {
            throw NSError(domain: "YapPersonMask", code: 1, userInfo: [NSLocalizedDescriptionKey: "No person mask for \(url.lastPathComponent)"])
        }
        guard let input = CIImage(contentsOf: url) else { fatalError("Cannot read the video frame") }
        let nativeMask = CIImage(cvPixelBuffer: buffer)
        // Accurate Vision masks can be larger than the input and have a
        // different aspect ratio. Normalize once to this exact video frame,
        // keeping browser decoding small and foreground sampling unambiguous.
        let image = nativeMask.transformed(by: CGAffineTransform(
            scaleX: input.extent.width / nativeMask.extent.width,
            y: input.extent.height / nativeMask.extent.height))
        guard let cg = context.createCGImage(image, from: input.extent, format: .L8,
                                            colorSpace: CGColorSpaceCreateDeviceGray()) else { fatalError("Cannot read the person mask") }
        let target = masks.appendingPathComponent(url.lastPathComponent)
        guard let writer = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Cannot save the person mask") }
        CGImageDestinationAddImage(writer, cg, nil)
        guard CGImageDestinationFinalize(writer) else { fatalError("Cannot finish the person mask") }
    }
    if index % 30 == 0 { print("Person masks: \(index + 1)/\(files.count)") }
}
