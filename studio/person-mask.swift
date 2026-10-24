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
let context = CIContext(options: [.useSoftwareRenderer: true])
let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .balanced
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
request.usesCPUOnly = true
for (index, url) in files.enumerated() {
    try autoreleasepool {
        let handler = VNImageRequestHandler(url: url, options: [:])
        try handler.perform([request])
        guard let buffer = request.results?.first?.pixelBuffer else {
            throw NSError(domain: "YapPersonMask", code: 1, userInfo: [NSLocalizedDescriptionKey: "No person mask for \(url.lastPathComponent)"])
        }
        let image = CIImage(cvPixelBuffer: buffer)
        guard let cg = context.createCGImage(image, from: image.extent) else { fatalError("Cannot read the person mask") }
        let target = masks.appendingPathComponent(url.lastPathComponent)
        guard let writer = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Cannot save the person mask") }
        CGImageDestinationAddImage(writer, cg, nil)
        guard CGImageDestinationFinalize(writer) else { fatalError("Cannot finish the person mask") }
    }
    if index % 30 == 0 { print("Person masks: \(index + 1)/\(files.count)") }
}
