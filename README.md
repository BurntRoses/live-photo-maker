# Live Photo Maker · 一刻 LIVE

Turn photos and videos into Live Photos, Motion Photos, MP4 and GIF, locally in your browser.

把照片或视频转成实况照片、安卓动态照片、MP4 或 GIF。支持手持镜头、远近视差、对焦、运动模糊、热气、烛光、环境声及照片信息编辑。

[在线使用](https://burntroses.github.io/live-photo-maker/) · [下载](https://github.com/BurntRoses/live-photo-maker/releases)

导入照片或视频，调整效果后选择导出格式。素材在浏览器本地处理；识别模型和兼容编码器按需联网加载。安卓和华为格式请保留原文件传输，图库识别取决于设备与系统版本。

苹果 Live Photo 导出为 JPG＋MOV 配对包。解压后用下载页的 Mac 导入工具存入照片图库，再同步到 iPhone。

## 开发

Node.js 24、pnpm 11：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

```sh
pnpm build
pnpm preview
```

构建输出为 `dist/index.html` 和 `dist/audio/`。下载的 HTML 可直接打开；内置声音从在线资源加载。Mac 导入工具需 Xcode Command Line Tools：

```sh
sh tools/macos/build.sh
```

## 许可

[GPL-3.0-or-later](LICENSE)。第三方软件和 CC0 音频的版权、来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。
