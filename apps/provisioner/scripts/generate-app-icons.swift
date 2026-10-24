// macOS asset conversion: reuse the website artwork without redrawing it.
// Run from any directory: swift apps/provisioner/scripts/generate-app-icons.swift
import Foundation
import CoreGraphics
import ImageIO
import CoreText

let app = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = app.appendingPathComponent("assets/app-icon/cashu.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let mascot = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
    fatalError("Cannot decode the Cashu mascot")
}
let green = CGColor(colorSpace: colorSpace, components: [16.0 / 255, 39.0 / 255, 30.0 / 255, 1])!
let files = FileManager.default
var written = 0

func render(_ size: Int, to relative: String, fraction: CGFloat = 0.76,
            foreground: Bool = false, round: Bool = false, alphaChannel: Bool = false) throws {
    let alpha: CGImageAlphaInfo = foreground || round || alphaChannel ? .premultipliedLast : .noneSkipLast
    guard let context = CGContext(data: nil, width: size, height: size,
                                  bitsPerComponent: 8, bytesPerRow: size * 4,
                                  space: colorSpace, bitmapInfo: alpha.rawValue) else {
        fatalError("Cannot create icon canvas")
    }
    let canvas = CGRect(x: 0, y: 0, width: size, height: size)
    if round { context.addEllipse(in: canvas); context.clip() }
    if !foreground { context.setFillColor(green); context.fill(canvas) }
    // Preserve the original pixel edges rather than introduce blurred resampling.
    context.interpolationQuality = .none
    context.setShouldAntialias(false)
    let height = (CGFloat(size) * fraction).rounded()
    let width = (height * CGFloat(mascot.width) / CGFloat(mascot.height)).rounded()
    context.draw(mascot, in: CGRect(x: ((CGFloat(size) - width) / 2).rounded(),
                                  y: ((CGFloat(size) - height) / 2).rounded(),
                                  width: width, height: height))
    let target = app.appendingPathComponent(relative)
    try files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(target as CFURL, "public.png" as CFString, 1, nil) else {
        fatalError("Cannot encode icon")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save icon") }
    written += 1
}

// Keep both existing catalogs aligned; Images.xcassets is the Xcode target's catalog.
for catalog in ["Images.xcassets", "Assets.xcassets"] {
    let folder = "ios/CashuProvisioner/\(catalog)/AppIcon.appiconset"
    let data = try Data(contentsOf: app.appendingPathComponent("\(folder)/Contents.json"))
    let manifest = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    for image in manifest["images"] as! [[String: String]] {
        guard let name = image["filename"], let points = image["size"], let scale = image["scale"],
              let side = Double(points.split(separator: "x")[0]),
              let multiplier = Double(scale.dropLast()) else { fatalError("Invalid AppIcon entry") }
        try render(Int((side * multiplier).rounded()), to: "\(folder)/\(name)")
    }
}
try render(1024, to: "assets/app-icon/icon-1024.png")
try render(512, to: "assets/play-assets/icon-512-generic.png", alphaChannel: true)
// Legacy upload paths must never reintroduce the previous NFC-card icon.
try render(512, to: "assets/cardart/icon-512.png", alphaChannel: true)

let fontURL = app.appendingPathComponent("assets/fonts/Figtree-SemiBold.ttf")
CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, nil)
guard let iconSource = CGImageSourceCreateWithURL(app.appendingPathComponent("assets/app-icon/icon-1024.png") as CFURL, nil),
      let icon = CGImageSourceCreateImageAtIndex(iconSource, 0, nil),
      let banner = CGContext(data: nil, width: 1024, height: 500, bitsPerComponent: 8,
                             bytesPerRow: 4096, space: colorSpace,
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Cannot create store feature graphic")
}
banner.setFillColor(green)
banner.fill(CGRect(x: 0, y: 0, width: 1024, height: 500))
banner.interpolationQuality = .none
banner.draw(icon, in: CGRect(x: 48, y: 90, width: 320, height: 320))
func line(_ text: String, size: CGFloat, y: CGFloat, color: CGColor) {
    let attributes = [kCTFontAttributeName as String: CTFontCreateWithName("Figtree-SemiBold" as CFString, size, nil),
                      kCTForegroundColorAttributeName as String: color] as CFDictionary
    let value = CFAttributedStringCreate(nil, text as CFString, attributes)!
    banner.textPosition = CGPoint(x: 410, y: y)
    CTLineDraw(CTLineCreateWithAttributedString(value), banner)
}
let pale = CGColor(colorSpace: colorSpace, components: [0.84, 0.91, 0.84, 1])!
line("Cashu", size: 64, y: 300, color: pale)
line("Provisioner", size: 64, y: 224, color: pale)
line("Install card software over NFC.", size: 24, y: 155, color: pale)
for relative in ["assets/play-assets/feature-graphic-generic.png", "assets/cardart/feature-graphic.png"] {
    let target = app.appendingPathComponent(relative)
    let destination = CGImageDestinationCreateWithURL(target as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, banner.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save feature graphic") }
    written += 1
}

for (density, scale) in [("mdpi", 1.0), ("hdpi", 1.5), ("xhdpi", 2.0), ("xxhdpi", 3.0), ("xxxhdpi", 4.0)] {
    let size = Int(48 * scale)
    let resources = "android/app/src/main/res"
    try render(size, to: "\(resources)/mipmap-\(density)/ic_launcher.png")
    try render(size, to: "\(resources)/mipmap-\(density)/ic_launcher_round.png", round: true)
    // Android's 108dp adaptive layer crops to the launcher mask. The silhouette
    // stays inside its central 66dp safe circle (54dp mascot height).
    try render(Int(108 * scale), to: "\(resources)/drawable-\(density)/cashu_icon_foreground.png",
               fraction: 54.0 / 108, foreground: true)
}
print("Generated \(written) Cashu brand assets from the website mascot.")
