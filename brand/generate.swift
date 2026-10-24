// brand/generate.swift: the Cashu Card mark, and every file drawn from it.
//
// The mark is the Cashu cashew drawn as a card's chip (D119). Its geometry and colors live here once. This script
// writes the brand library under brand/ (SVG masters, PNGs, favicons, lockups, tokens) and the provisioner's app and
// store icons from them, so no file is redrawn by hand.
//
// Run on macOS from anywhere: swift brand/generate.swift
import Foundation
import CoreGraphics
import CoreText
import ImageIO

let brand = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let repo = brand.deletingLastPathComponent()
let files = FileManager.default
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
var written = 0

// MARK: - The mark, in a 100-unit box (SVG coordinates: y runs down)

// The cashew: a round head, one inner curve and a hooked tail, turned 14 degrees to the left. M, then C segments.
let cashew: [[CGFloat]] = [
    [58, 7], [76, 7, 90, 18, 90, 33], [90, 46, 78, 50, 66, 52], [58, 53, 55, 60, 59, 68],
    [62, 74, 70, 77, 70, 85], [70, 92, 63, 96, 54, 96], [30, 96, 10, 77, 10, 52], [10, 27, 31, 7, 58, 7]]
let tilt: CGFloat = -14
// The chip: a center pad and five contact lines, cut through the cashew.
let pad = CGRect(x: 30, y: 34, width: 24, height: 30), padRadius: CGFloat = 5
let contacts: [[CGFloat]] = [[-2, 42, 30, 42], [-2, 56, 30, 56], [54, 40, 102, 40], [42, -2, 42, 34], [42, 64, 42, 102]]
let lineWeight: CGFloat = 3.4
// At this many pixels and below, the contact lines would be under a pixel wide: small sizes use the plain cashew.
let smallUpTo = 40
// An app icon is the mark at 62% of its side on the deep green, lit from the upper right.
let iconInset: CGFloat = 0.62

// MARK: - Colors

let colors: [(String, String, String)] = [   // token, hex, use
    ("ground", "#10271E", "Deep green: the background of the site, the icons and the film"),
    ("ground-raised", "#15332A", "Panels on the deep green"),
    ("ink", "#EDF3E7", "Text on the deep green"),
    ("sage", "#BECFC0", "Secondary text on the deep green"),
    ("mute", "#92A998", "Captions and labels on the deep green"),
    ("wordmark-soft", "#AABDB0", "\"card\" in the wordmark, on dark"),
    ("lime", "#D3F39A", "The accent: buttons and highlights"),
    ("dot", "#B7EA7C", "The status dot"),
    ("chip-light", "#ECF9BD", "The mark's gradient, first stop"),
    ("chip-mid", "#CFE98F", "The mark's gradient, middle stop"),
    ("chip-deep", "#A6CC6A", "The mark's gradient, last stop"),
    ("paper", "#F3F7EE", "Light background"),
    ("paper-soft", "#557A62", "\"card\" in the wordmark, on light"),
    ("glow", "#2B4C31", "The icon's light, upper right"),
    ("glow-mid", "#173526", "The icon's light, falling off")]
func hex(_ token: String) -> String { colors.first { $0.0 == token }!.1 }
let chipStops: [(String, CGFloat)] = [(hex("chip-light"), 0), (hex("chip-mid"), 0.55), (hex("chip-deep"), 1)]
let glowStops: [(String, CGFloat)] = [(hex("glow"), 0), (hex("glow-mid"), 0.38), (hex("ground"), 0.75), (hex("ground"), 1)]
let glowCenter = CGPoint(x: 72, y: 30), glowRadius: CGFloat = 100

func cgColor(_ hex: String) -> CGColor {
    let v = Int(hex.dropFirst(), radix: 16)!
    return CGColor(colorSpace: sRGB, components: [CGFloat((v >> 16) & 255) / 255, CGFloat((v >> 8) & 255) / 255, CGFloat(v & 255) / 255, 1])!
}
func gradient(_ stops: [(String, CGFloat)]) -> CGGradient {
    CGGradient(colorsSpace: sRGB, colors: stops.map { cgColor($0.0) } as CFArray, locations: stops.map { $0.1 })!
}

// MARK: - Drawing (Core Graphics, in a context turned to SVG orientation)

func cashewPath() -> CGPath {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: cashew[0][0], y: cashew[0][1]))
    for c in cashew.dropFirst() {
        p.addCurve(to: CGPoint(x: c[4], y: c[5]), control1: CGPoint(x: c[0], y: c[1]), control2: CGPoint(x: c[2], y: c[3]))
    }
    p.closeSubpath()
    return p
}
func turn(_ c: CGContext, _ degrees: CGFloat) {
    c.translateBy(x: 50, y: 50); c.rotate(by: degrees * .pi / 180); c.translateBy(x: -50, y: -50)
}
enum Fill { case chip, solid(String) }

// The mark into a box. The gradient runs across the unturned box, as the SVG's does; the chip is cut out, so what
// shows through is whatever lies beneath.
func drawMark(_ c: CGContext, in box: CGRect, fill: Fill, small: Bool) {
    c.saveGState()
    c.translateBy(x: box.minX, y: box.minY); c.scaleBy(x: box.width / 100, y: box.height / 100)
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.saveGState()
    turn(c, tilt); c.addPath(cashewPath()); c.clip(); turn(c, -tilt)
    switch fill {
    case .chip:
        c.drawLinearGradient(gradient(chipStops), start: .zero, end: CGPoint(x: 100, y: 100),
                             options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    case .solid(let h):
        c.setFillColor(cgColor(h)); c.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
    }
    c.restoreGState()
    if !small {
        c.saveGState()
        turn(c, tilt); c.setBlendMode(.clear); c.setLineWidth(lineWeight)
        c.addPath(CGPath(roundedRect: pad, cornerWidth: padRadius, cornerHeight: padRadius, transform: nil))
        for l in contacts { c.move(to: CGPoint(x: l[0], y: l[1])); c.addLine(to: CGPoint(x: l[2], y: l[3])) }
        c.strokePath()
        c.restoreGState()
    }
    c.endTransparencyLayer()
    c.restoreGState()
}

// The icon's ground: the deep green, lit from the upper right; a square, a rounded tile or a circle.
enum Tile { case square, rounded, circle }
func drawGround(_ c: CGContext, side: CGFloat, tile: Tile) {
    c.saveGState()
    c.scaleBy(x: side / 100, y: side / 100)
    switch tile {
    case .square: break
    case .rounded: c.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 100, height: 100), cornerWidth: 22.4, cornerHeight: 22.4, transform: nil)); c.clip()
    case .circle: c.addEllipse(in: CGRect(x: 0, y: 0, width: 100, height: 100)); c.clip()
    }
    c.drawRadialGradient(gradient(glowStops), startCenter: glowCenter, startRadius: 0, endCenter: glowCenter, endRadius: glowRadius,
                         options: [.drawsAfterEndLocation])
    c.restoreGState()
}

func canvas(_ w: Int, _ h: Int, opaque: Bool) -> CGContext {
    let info: CGImageAlphaInfo = opaque ? .noneSkipLast : .premultipliedLast
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB, bitmapInfo: info.rawValue)!
    c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: 1, y: -1)   // SVG orientation: y runs down
    return c
}
func pngData(_ c: CGContext) -> Data {
    let data = NSMutableData()
    let d = CGImageDestinationCreateWithData(data as CFMutableData, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(d, c.makeImage()!, nil)
    guard CGImageDestinationFinalize(d) else { fatalError("Cannot encode PNG") }
    return data as Data
}
func write(_ data: Data, _ relative: String) throws {
    let url = repo.appendingPathComponent(relative)
    try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url)
    written += 1
}
func write(_ text: String, _ relative: String) throws { try write(Data(text.utf8), relative) }

// An icon: the ground and the mark, square and opaque unless asked otherwise.
func iconPNG(_ side: Int, tile: Tile = .square, inset: CGFloat = iconInset, ground: Bool = true) -> Data {
    let s = CGFloat(side)
    let c = canvas(side, side, opaque: tile == .square && ground)
    if ground { drawGround(c, side: s, tile: tile) }
    let m = s * inset
    drawMark(c, in: CGRect(x: (s - m) / 2, y: (s - m) / 2, width: m, height: m), fill: .chip, small: side <= smallUpTo)
    return pngData(c)
}

// MARK: - SVG

func num(_ v: CGFloat) -> String {
    let r = (v * 100).rounded() / 100
    return r == r.rounded() ? String(Int(r)) : String(format: "%g", Double(r))
}
let cashewD = "M\(num(cashew[0][0])) \(num(cashew[0][1]))" + cashew.dropFirst().map { c in "C" + c.map(num).joined(separator: " ") }.joined() + "Z"
let contactsD = contacts.map { "M\(num($0[0])) \(num($0[1]))L\(num($0[2])) \(num($0[3]))" }.joined()
func stopsSVG(_ stops: [(String, CGFloat)]) -> String {
    stops.map { "<stop offset=\"\(num($0.1))\" stop-color=\"\($0.0)\"/>" }.joined()
}
// The mark's definitions under an id prefix: its gradient, and the mask that cuts the cashew and its chip.
func markDefs(_ id: String, small: Bool) -> String {
    let chip = small ? "" : "<g fill=\"none\" stroke=\"#000\" stroke-width=\"\(num(lineWeight))\"><rect x=\"\(num(pad.minX))\" y=\"\(num(pad.minY))\" width=\"\(num(pad.width))\" height=\"\(num(pad.height))\" rx=\"\(num(padRadius))\"/><path d=\"\(contactsD)\"/></g>"
    return "<linearGradient id=\"\(id)-chip\" gradientUnits=\"userSpaceOnUse\" x1=\"0\" y1=\"0\" x2=\"100\" y2=\"100\">\(stopsSVG(chipStops))</linearGradient>"
        + "<mask id=\"\(id)-cut\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"100\" height=\"100\"><g transform=\"rotate(\(num(tilt)) 50 50)\"><path d=\"\(cashewD)\" fill=\"#fff\"/>\(chip)</g></mask>"
}
func markBody(_ id: String, fill: Fill) -> String {
    let paint: String
    switch fill { case .chip: paint = "url(#\(id)-chip)"; case .solid(let h): paint = h }
    return "<rect width=\"100\" height=\"100\" fill=\"\(paint)\" mask=\"url(#\(id)-cut)\"/>"
}
let groundDefs = "<radialGradient id=\"cc-glow\" gradientUnits=\"userSpaceOnUse\" cx=\"\(num(glowCenter.x))\" cy=\"\(num(glowCenter.y))\" r=\"\(num(glowRadius))\">\(stopsSVG(glowStops))</radialGradient>"
func svg(_ w: CGFloat, _ h: CGFloat, size: (Int, Int), defs: String, body: String) -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(num(w)) \(num(h))\" width=\"\(size.0)\" height=\"\(size.1)\">"
        + "<title>Cashu Card</title><defs>\(defs)</defs>\(body)</svg>\n"
}
func markSVG(fill: Fill, small: Bool) -> String {
    svg(100, 100, size: (512, 512), defs: markDefs("cc", small: small), body: markBody("cc", fill: fill))
}
func iconSVG(tile: Tile, small: Bool, size: Int) -> String {
    let o = num((1 - iconInset) * 50), k = num(iconInset)
    let ground = tile == .rounded ? "<rect width=\"100\" height=\"100\" rx=\"22.4\" fill=\"url(#cc-glow)\"/>" : "<rect width=\"100\" height=\"100\" fill=\"url(#cc-glow)\"/>"
    return svg(100, 100, size: (size, size), defs: groundDefs + markDefs("cc", small: small),
               body: ground + "<g transform=\"translate(\(o) \(o)) scale(\(k))\">\(markBody("cc", fill: .chip))</g>")
}

// MARK: - The wordmark: "cashu" in Figtree 800 and "card" in Figtree 400, tracked in by 0.065 em

let fontURL = brand.appendingPathComponent("fonts/Figtree-Variable.ttf")
guard let fontData = CGDataProvider(url: fontURL as CFURL), let figtree = CGFont(fontData) else { fatalError("Cannot load Figtree") }
func figtreeFont(_ size: CGFloat, weight: Int) -> CTFont {
    let base = CTFontCreateWithGraphicsFont(figtree, size, nil, nil)
    let wght = NSNumber(value: 0x77676874)   // the 'wght' axis
    let d = CTFontDescriptorCreateWithAttributes([kCTFontVariationAttribute as String: [wght: weight]] as CFDictionary)
    return CTFontCreateCopyWithAttributes(base, size, nil, d)
}
struct Wordmark { var glyphs: [(CGPath, String)]; var width: CGFloat; var ascent: CGFloat; var descent: CGFloat }
// Glyph outlines with their parts: the bold part takes `ink`, the regular part `soft`. Baseline at y = 0, y down.
func wordmark(size: CGFloat) -> Wordmark {
    let track = -0.065 * size
    let text = NSMutableAttributedString()
    for (part, weight, role) in [("cashu", 800, "ink"), ("card", 400, "soft")] {
        text.append(NSAttributedString(string: part, attributes: [
            kCTFontAttributeName as NSAttributedString.Key: figtreeFont(size, weight: weight),
            kCTKernAttributeName as NSAttributedString.Key: track,
            NSAttributedString.Key("cc-role"): role]))
    }
    let line = CTLineCreateWithAttributedString(text)
    var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
    let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading)) - track   // no tracking after the last letter
    var glyphs: [(CGPath, String)] = []
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let attributes = CTRunGetAttributes(run) as NSDictionary
        let font = attributes[kCTFontAttributeName as String] as! CTFont
        let role = attributes["cc-role"] as! String
        let n = CTRunGetGlyphCount(run)
        var ids = [CGGlyph](repeating: 0, count: n), at = [CGPoint](repeating: .zero, count: n)
        CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &ids)
        CTRunGetPositions(run, CFRange(location: 0, length: 0), &at)
        for i in 0..<n {
            var flip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: at[i].x, ty: -at[i].y)
            if let p = CTFontCreatePathForGlyph(font, ids[i], &flip) { glyphs.append((p, role)) }
        }
    }
    return Wordmark(glyphs: glyphs, width: width, ascent: ascent, descent: descent)
}
func pathD(_ p: CGPath, dx: CGFloat, dy: CGFloat) -> String {
    var d = ""
    p.applyWithBlock { e in
        let pts = e.pointee.points
        func pt(_ i: Int) -> String { "\(num(pts[i].x + dx)) \(num(pts[i].y + dy))" }
        switch e.pointee.type {
        case .moveToPoint: d += "M" + pt(0)
        case .addLineToPoint: d += "L" + pt(0)
        case .addQuadCurveToPoint: d += "Q" + pt(0) + " " + pt(1)
        case .addCurveToPoint: d += "C" + pt(0) + " " + pt(1) + " " + pt(2)
        case .closeSubpath: d += "Z"
        @unknown default: break
        }
    }
    return d
}
// A lockup: the mark at 1.25 em, a 0.32 em gap, then the wordmark, the mark centered on the letters' height.
struct Lockup { var w: CGFloat; var h: CGFloat; var mark: CGRect; var baseline: CGFloat; var textX: CGFloat; var words: Wordmark }
func lockup(size: CGFloat = 100) -> Lockup {
    let words = wordmark(size: size)
    let m = 1.25 * size, gap = 0.32 * size
    let baseline = m / 2 + (words.ascent - words.descent) / 2
    let h = max(m, baseline + words.descent)
    return Lockup(w: m + gap + words.width, h: h, mark: CGRect(x: 0, y: 0, width: m, height: m), baseline: baseline, textX: m + gap, words: words)
}
func lockupSVG(_ L: Lockup, markFill: Fill, ink: String, soft: String, pixelHeight: Int) -> String {
    var body = "<g transform=\"scale(\(num(L.mark.width / 100)))\">\(markBody("cc", fill: markFill))</g>"
    for role in ["ink", "soft"] {
        let d = L.words.glyphs.filter { $0.1 == role }.map { pathD($0.0, dx: L.textX, dy: L.baseline) }.joined()
        body += "<path fill=\"\(role == "ink" ? ink : soft)\" d=\"\(d)\"/>"
    }
    let pw = Int((CGFloat(pixelHeight) * L.w / L.h).rounded())
    return svg(L.w, L.h, size: (pw, pixelHeight), defs: markDefs("cc", small: false), body: body)
}
func lockupPNG(_ L: Lockup, markFill: Fill, ink: String, soft: String, pixelHeight: Int) -> Data {
    let k = CGFloat(pixelHeight) / L.h
    let c = canvas(Int((L.w * k).rounded()), pixelHeight, opaque: false)
    c.scaleBy(x: k, y: k)
    drawMark(c, in: L.mark, fill: markFill, small: false)
    for (p, role) in L.words.glyphs {
        c.saveGState(); c.translateBy(x: L.textX, y: L.baseline)
        c.addPath(p); c.setFillColor(cgColor(role == "ink" ? ink : soft)); c.fillPath()
        c.restoreGState()
    }
    return pngData(c)
}

// MARK: - Favicon (an ICO holding PNGs)

func ico(_ sides: [Int]) -> Data {
    let images = sides.map { iconPNG($0, tile: .rounded) }
    var out = Data()
    func u16(_ v: Int) { var x = UInt16(v).littleEndian; out.append(Data(bytes: &x, count: 2)) }
    func u32(_ v: Int) { var x = UInt32(v).littleEndian; out.append(Data(bytes: &x, count: 4)) }
    u16(0); u16(1); u16(sides.count)
    var offset = 6 + 16 * sides.count
    for (side, image) in zip(sides, images) {
        out.append(UInt8(side >= 256 ? 0 : side)); out.append(UInt8(side >= 256 ? 0 : side)); out.append(0); out.append(0)
        u16(1); u16(32); u32(image.count); u32(offset)
        offset += image.count
    }
    images.forEach { out.append($0) }
    return out
}

// MARK: - The library

try write(markSVG(fill: .chip, small: false), "brand/mark/cashu-card-mark.svg")
try write(markSVG(fill: .solid(hex("ground")), small: false), "brand/mark/cashu-card-mark-green.svg")
try write(markSVG(fill: .solid("#FFFFFF"), small: false), "brand/mark/cashu-card-mark-white.svg")
try write(markSVG(fill: .chip, small: true), "brand/mark/cashu-card-mark-small.svg")
try write(markSVG(fill: .solid(hex("ground")), small: true), "brand/mark/cashu-card-mark-small-green.svg")
for (name, fill) in [("", Fill.chip), ("-green", Fill.solid(hex("ground"))), ("-white", Fill.solid("#FFFFFF"))] {
    let c = canvas(1024, 1024, opaque: false)
    drawMark(c, in: CGRect(x: 0, y: 0, width: 1024, height: 1024), fill: fill, small: false)
    try write(pngData(c), "brand/mark/cashu-card-mark\(name)-1024.png")
}

try write(iconSVG(tile: .square, small: false, size: 1024), "brand/icon/cashu-card-icon.svg")
try write(iconPNG(1024), "brand/icon/cashu-card-icon-1024.png")
// A social avatar: square, with the mark smaller so a circle crop keeps room around it.
try write(iconPNG(400, inset: 0.56), "brand/icon/cashu-card-avatar-400.png")

try write(iconSVG(tile: .rounded, small: true, size: 32), "brand/web/favicon.svg")
try write(ico([16, 32, 48]), "brand/web/favicon.ico")
try write(iconPNG(32, tile: .rounded), "brand/web/favicon-32.png")
try write(iconPNG(180), "brand/web/apple-touch-icon.png")
try write(iconPNG(192), "brand/web/icon-192.png")
try write(iconPNG(512), "brand/web/icon-512.png")

let L = lockup()
try write(lockupSVG(L, markFill: .chip, ink: hex("ink"), soft: hex("wordmark-soft"), pixelHeight: 120), "brand/lockup/cashu-card-lockup-on-dark.svg")
try write(lockupSVG(L, markFill: .solid(hex("ground")), ink: hex("ground"), soft: hex("paper-soft"), pixelHeight: 120), "brand/lockup/cashu-card-lockup-on-light.svg")
try write(lockupPNG(L, markFill: .chip, ink: hex("ink"), soft: hex("wordmark-soft"), pixelHeight: 360), "brand/lockup/cashu-card-lockup-on-dark.png")
try write(lockupPNG(L, markFill: .solid(hex("ground")), ink: hex("ground"), soft: hex("paper-soft"), pixelHeight: 360), "brand/lockup/cashu-card-lockup-on-light.png")

let tokenJSON = "{\n" + colors.map { "  \"\($0.0)\": { \"value\": \"\($0.1)\", \"use\": \"\($0.2.replacingOccurrences(of: "\"", with: "\\\""))\" }" }.joined(separator: ",\n")
    + ",\n  \"font\": { \"value\": \"Figtree\", \"use\": \"Every word in the brand: 800 for \\\"cashu\\\" and headlines, 400 for \\\"card\\\" and text\" }\n}\n"
try write(tokenJSON, "brand/tokens.json")
try write("/* Cashu Card colors (brand/tokens.json; written by brand/generate.swift) */\n:root {\n"
    + colors.map { "  --cc-\($0.0): \($0.1);" }.joined(separator: "\n")
    + "\n  --cc-chip: linear-gradient(135deg, \(chipStops.map { "\($0.0) \(Int($0.1 * 100))%" }.joined(separator: ", ")));\n  --cc-font: \"Figtree\", \"Helvetica Neue\", Arial, sans-serif;\n}\n", "brand/tokens.css")

// MARK: - The provisioner's icons

let app = "apps/provisioner"
// Both catalogs stay aligned; Images.xcassets is the Xcode target's catalog. iOS icons are opaque squares.
for catalog in ["Images.xcassets", "Assets.xcassets"] {
    let folder = "\(app)/ios/CashuProvisioner/\(catalog)/AppIcon.appiconset"
    let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: repo.appendingPathComponent("\(folder)/Contents.json"))) as! [String: Any]
    for image in manifest["images"] as! [[String: String]] {
        guard let name = image["filename"], let points = image["size"], let scale = image["scale"],
              let side = Double(points.split(separator: "x")[0]), let multiplier = Double(scale.dropLast()) else { fatalError("Invalid AppIcon entry") }
        try write(iconPNG(Int((side * multiplier).rounded())), "\(folder)/\(name)")
    }
}
try write(iconPNG(1024), "\(app)/assets/app-icon/icon-1024.png")
// Google Play takes a 32-bit RGBA PNG with an opaque background; the legacy upload path keeps the same icon.
func playIcon() -> Data {
    let c = canvas(512, 512, opaque: false)
    drawGround(c, side: 512, tile: .square)
    let m = 512 * iconInset
    drawMark(c, in: CGRect(x: (512 - m) / 2, y: (512 - m) / 2, width: m, height: m), fill: .chip, small: false)
    return pngData(c)
}
try write(playIcon(), "\(app)/assets/play-assets/icon-512-generic.png")
try write(playIcon(), "\(app)/assets/cardart/icon-512.png")

// The store feature graphic: the mark on the deep green, beside the app's name, in Figtree 600.
let banner = canvas(1024, 500, opaque: true)
banner.setFillColor(cgColor(hex("ground"))); banner.fill(CGRect(x: 0, y: 0, width: 1024, height: 500))
drawMark(banner, in: CGRect(x: 60, y: 100, width: 300, height: 300), fill: .chip, small: false)
banner.saveGState()
banner.translateBy(x: 0, y: 500); banner.scaleBy(x: 1, y: -1)   // text draws with y up
for (text, size, y) in [("Cashu", CGFloat(64), CGFloat(300)), ("Provisioner", 64, 224), ("Install card software over NFC.", 24, 155)] {
    let attributes = [kCTFontAttributeName as String: figtreeFont(size, weight: 600),
                      kCTForegroundColorAttributeName as String: cgColor(hex("ink"))] as CFDictionary
    banner.textPosition = CGPoint(x: 410, y: y)
    CTLineDraw(CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, text as CFString, attributes)!), banner)
}
banner.restoreGState()
for path in ["\(app)/assets/play-assets/feature-graphic-generic.png", "\(app)/assets/cardart/feature-graphic.png"] {
    try write(pngData(banner), path)
}

// Android: legacy square and round launchers, and the adaptive foreground. The adaptive layer is 108 dp and the
// launcher shows its central 72 dp, so the mark takes 62% of 72 dp, well inside the 66 dp safe circle.
for (density, scale) in [("mdpi", 1.0), ("hdpi", 1.5), ("xhdpi", 2.0), ("xxhdpi", 3.0), ("xxxhdpi", 4.0)] {
    let res = "\(app)/android/app/src/main/res"
    try write(iconPNG(Int(48 * scale)), "\(res)/mipmap-\(density)/ic_launcher.png")
    try write(iconPNG(Int(48 * scale), tile: .circle), "\(res)/mipmap-\(density)/ic_launcher_round.png")
    try write(iconPNG(Int(108 * scale), inset: iconInset * 72 / 108, ground: false), "\(res)/drawable-\(density)/cashu_icon_foreground.png")
}

print("Wrote \(written) files from the Cashu Card mark.")
