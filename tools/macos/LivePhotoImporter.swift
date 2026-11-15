// SPDX-License-Identifier: GPL-3.0-or-later
// A local, user-operated PhotoKit importer. No network or automatic library writes.
import AppKit
import Photos
import UniformTypeIdentifiers

final class Importer: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var info: NSTextField!
    private var save: NSButton!
    private var imageURL: URL?
    private var videoURL: URL?
    private var livePhoto: PHLivePhoto?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 370), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Live Photo Studio · 导入苹果照片图库"
        let view = window.contentView!
        let title = NSTextField(labelWithString: "把选定的 Live 照片存入系统图库")
        title.font = .systemFont(ofSize: 23, weight: .semibold)
        title.frame = NSRect(x: 30, y: 302, width: 540, height: 35); view.addSubview(title)
        let note = NSTextField(wrappingLabelWithString: "先解压网页导出的苹果资源包，然后选择包含同名 JPG 和 MOV 的文件夹。工具会先检查配对，只有点击存入图库后才申请照片权限。")
        note.frame = NSRect(x: 30, y: 231, width: 540, height: 62); view.addSubview(note)
        let choose = NSButton(title: "选择资源文件夹…", target: self, action: #selector(selectPair))
        choose.frame = NSRect(x: 30, y: 182, width: 190, height: 36); choose.bezelStyle = .rounded; view.addSubview(choose)
        info = NSTextField(wrappingLabelWithString: "尚未选择文件。原照片和视频不会被改动。")
        info.frame = NSRect(x: 30, y: 82, width: 540, height: 85); view.addSubview(info)
        save = NSButton(title: "存入照片图库", target: self, action: #selector(importPair))
        save.frame = NSRect(x: 370, y: 25, width: 200, height: 38); save.bezelStyle = .rounded; save.isEnabled = false; view.addSubview(save)
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @objc private func selectPair() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.message = "选择已解压的苹果 Live 资源文件夹"
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        save.isEnabled = false; livePhoto = nil
        do {
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            let pairs = files.filter { ["jpg", "jpeg"].contains($0.pathExtension.lowercased()) }.compactMap { image -> (URL, URL)? in
                let base = image.deletingPathExtension().lastPathComponent
                guard let video = files.first(where: { $0.pathExtension.lowercased() == "mov" && $0.deletingPathExtension().lastPathComponent == base }) else { return nil }
                return (image, video)
            }
            guard pairs.count == 1 else { throw ImportError.message("请选只包含一对同名 JPG 和 MOV 的资源文件夹；当前找到 \(pairs.count) 对。") }
            imageURL = pairs[0].0; videoURL = pairs[0].1; info.stringValue = "正在使用系统 Live Photo 解析器验证配对…"
            PHLivePhoto.request(withResourceFileURLs: [pairs[0].0, pairs[0].1], placeholderImage: nil, targetSize: NSSize(width: 540, height: 720), contentMode: .aspectFit) { [weak self] photo, details in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let photo {
                        self.livePhoto = photo; self.info.stringValue = "系统已成功解析 Live 配对：\(pairs[0].0.lastPathComponent)\n点击存入后，在 Mac 照片 App 中检查 LIVE 标识，再通过 iCloud 照片或从照片 App 分享到 iPhone。"
                        self.save.isEnabled = true
                    } else if (details[PHLivePhotoInfoIsDegradedKey] as? Bool) != true {
                        self.info.stringValue = "系统无法解析此 Live 配对。\((details[PHLivePhotoInfoErrorKey] as? Error)?.localizedDescription ?? "请确认 JPG 与 MOV 来自同一次导出，且未被其他软件压缩或转换。")"
                    }
                }
            }
        } catch { info.stringValue = error.localizedDescription }
    }

    @objc private func importPair() {
        guard livePhoto != nil, let image = imageURL, let video = videoURL else { return }
        save.isEnabled = false
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { self?.info.stringValue = "尚未允许存入照片。请在系统设置 → 隐私与安全性 → 照片中允许本工具，然后重试。"; self?.save.isEnabled = true }; return
            }
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let imageOptions = PHAssetResourceCreationOptions(); imageOptions.originalFilename = image.lastPathComponent
                let videoOptions = PHAssetResourceCreationOptions(); videoOptions.originalFilename = video.lastPathComponent
                request.addResource(with: .photo, fileURL: image, options: imageOptions)
                request.addResource(with: .pairedVideo, fileURL: video, options: videoOptions)
            }) { success, error in
                DispatchQueue.main.async {
                    self?.info.stringValue = success ? "已存入 Mac 照片图库。打开照片 App 的最近保存，检查 LIVE 标识与声音，再通过 iCloud 照片或照片 App 的分享功能传到 iPhone。" : "保存失败：\(error?.localizedDescription ?? "未知错误")"
                    self?.save.isEnabled = !success
                }
            }
        }
    }
    enum ImportError: LocalizedError { case message(String); var errorDescription: String? { if case let .message(text) = self { return text }; return nil } }
}

let delegate = Importer()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
