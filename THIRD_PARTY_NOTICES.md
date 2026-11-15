# 第三方许可

本项目采用 [GPL-3.0-or-later](LICENSE)。第三方软件与录音保留各自许可，完整原文见 [licenses](licenses/)。

## JavaScript

| 软件 | 版本 | 作者 / 版权所有者 | 许可原文 | 源码 |
|---|---|---|---|---|
| mediabunny | 1.65.2 | © 2026-present Vanilagy and contributors | [MPL-2.0](licenses/mediabunny-MPL-2.0.txt) | [上游](https://github.com/Vanilagy/mediabunny)、[此版本 npm 包，含 `src/`](https://registry.npmjs.org/mediabunny/-/mediabunny-1.65.2.tgz) |
| exifr | 7.1.3 | © 2020 Mike Kovařík, Mutiny.cz | [MIT](licenses/exifr-MIT.txt) | [上游](https://github.com/MikeKovarik/exifr)、[7.1.3 包](https://registry.npmjs.org/exifr/-/exifr-7.1.3.tgz) |
| fflate | 0.8.2 | © 2023 Arjun Barrett | [MIT](licenses/fflate-MIT.txt) | [上游](https://github.com/101arrowz/fflate)、[0.8.2 包](https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz) |
| gifenc | 1.0.3 | © 2017 Matt DesLauriers | [MIT](licenses/gifenc-MIT.txt) | [上游](https://github.com/mattdesl/gifenc)、[1.0.3 包](https://registry.npmjs.org/gifenc/-/gifenc-1.0.3.tgz) |
| @ffmpeg/ffmpeg（worker） | 0.12.15 | © 2019 Jerome Wu | [MIT](licenses/ffmpeg-wasm-MIT.txt) | [v12.15](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15/packages/ffmpeg) |
| @mediapipe/tasks-vision | 0.10.32 | Google LLC / The MediaPipe Authors | [Apache-2.0 及上游附带声明](licenses/mediapipe-Apache-2.0.txt) | [v0.10.32](https://github.com/google-ai-edge/mediapipe/tree/v0.10.32/mediapipe/tasks/web)、[0.10.32 包](https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.32.tgz) |

`mediabunny` 的 MPL-2.0 覆盖源码可从上表版本包内的 `src/` 免费取得、修改和再分发。

## FFmpeg WebAssembly

本软件使用 FFmpeg 代码，其许可为 GNU GPL v2 或更高版本。`@ffmpeg/core@0.12.10` 采用 [GPL-2.0-or-later](licenses/GPL-2.0.txt)；JavaScript 包装层的 MIT 许可不替代核心许可。

运行时加载的独立文件：

- [`ffmpeg-core.js`](https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js)
- [`ffmpeg-core.wasm`](https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm)
- [同版本完整 npm 发布包](https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz)

对应源码的取得方式：

1. 下载 [ffmpeg.wasm 源码归档](https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz)，或检出提交 `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`（标签 **`v12.15`**）。其 [`packages/core/package.json`](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/packages/core/package.json) 对应 core **0.12.10**。
2. 该提交的 [`Dockerfile`](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile)、[`build/`](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build)、`src/bind` 和 `src/fftools` 提供构建脚本、绑定及适配代码。构建使用 Emscripten 3.1.40，FFmpeg 源码为 [`n5.1.4`](https://github.com/FFmpeg/FFmpeg/tree/n5.1.4)，配置启用了 `--enable-gpl`、libx264、libx265 及下表的外部库。依照仓库 `Makefile` 与 `Dockerfile` 可取得并构建这些源码。
3. 外部库源码与许可见下表；`x264:4-cores` 和 `lame:master` 为上游配方中的分支引用。

| 核心外部库 / 配方引用 | 源码 | 随附许可 |
|---|---|---|
| x264 / `4-cores` | [ffmpegwasm/x264](https://github.com/ffmpegwasm/x264/tree/4-cores) | [GPL v2](licenses/x264-COPYING.txt) |
| x265 / `3.4` | [ffmpegwasm/x265](https://github.com/ffmpegwasm/x265/tree/3.4) | [GPL v2](licenses/x265-COPYING.txt) |
| libvpx / `v1.13.1` | [ffmpegwasm/libvpx](https://github.com/ffmpegwasm/libvpx/tree/v1.13.1) | [BSD](licenses/libvpx-LICENSE.txt) |
| LAME / `master` | [ffmpegwasm/lame](https://github.com/ffmpegwasm/lame) | [GNU Library GPL v2](licenses/lame-COPYING.txt) |
| Ogg / `v1.3.4` | [ffmpegwasm/Ogg](https://github.com/ffmpegwasm/Ogg/tree/v1.3.4) | [BSD](licenses/ogg-COPYING.txt) |
| Theora / `v1.1.1` | [ffmpegwasm/theora](https://github.com/ffmpegwasm/theora/tree/v1.1.1) | [BSD](licenses/theora-COPYING.txt) |
| Opus / `v1.3.1` | [ffmpegwasm/opus](https://github.com/ffmpegwasm/opus/tree/v1.3.1) | [BSD](licenses/opus-COPYING.txt) |
| Vorbis / `v1.3.3` | [ffmpegwasm/vorbis](https://github.com/ffmpegwasm/vorbis/tree/v1.3.3) | [BSD](licenses/vorbis-COPYING.txt) |
| zlib / `v1.2.11` | [ffmpegwasm/zlib](https://github.com/ffmpegwasm/zlib/tree/v1.2.11) | [zlib 版权与许可，见文件末尾](licenses/zlib-LICENSE.txt) |
| libwebp / `v1.3.2` | [ffmpegwasm/libwebp](https://github.com/ffmpegwasm/libwebp/tree/v1.3.2) | [BSD](licenses/libwebp-COPYING.txt) |
| FreeType / `VER-2-10-4` | [ffmpegwasm/freetype2](https://github.com/ffmpegwasm/freetype2/tree/VER-2-10-4) | [FreeType License](licenses/freetype-FTL.txt) |
| FriBidi / `v1.0.9` | [fribidi/fribidi](https://github.com/fribidi/fribidi/tree/v1.0.9) | [LGPL v2.1](licenses/fribidi-COPYING.txt) |
| HarfBuzz / `5.2.0` | [harfbuzz/harfbuzz](https://github.com/harfbuzz/harfbuzz/tree/5.2.0) | [宽松许可及版权声明](licenses/harfbuzz-COPYING.txt) |
| libass / `0.15.0` | [libass/libass](https://github.com/libass/libass/tree/0.15.0) | [ISC](licenses/libass-COPYING.txt) |
| zimg / `release-3.0.5` | [sekrit-twc/zimg](https://github.com/sekrit-twc/zimg/tree/release-3.0.5) | [WTFPL v2](licenses/zimg-COPYING.txt) |

Portions of this software are copyright © 2020 The FreeType Project (www.freetype.org). All rights reserved.

FFmpeg 版权属于 FFmpeg developers 及各源文件列出的贡献者；上述库的具体版权所有者与保留条款见对应许可原文。FFmpeg 官方许可说明：[FFmpeg Legal](https://ffmpeg.org/legal.html)。

## MediaPipe WASM 与模型

`@mediapipe/tasks-vision@0.10.32` 的 WASM / loader 来自 [unpkg](https://unpkg.com/@mediapipe/tasks-vision@0.10.32/wasm/) 或 [jsDelivr](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/)，采用 [Apache-2.0](licenses/mediapipe-Apache-2.0.txt)。

Google 提供的模型均采用 Apache-2.0，原始文件与模型卡如下：

| 模型 | 使用的官方文件 | 官方许可证据 |
|---|---|---|
| BlazePose GHUM 3D Lite / Pose Landmarker Lite，float16，v1 | [`pose_landmarker_lite.task`](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | [BlazePose GHUM 3D Model Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)，第 2 页 Apache-2.0；Valentin Bazarevsky、Ivan Grishchenko、Eduard Gabriel Bazavan（Google）。 |
| BlazeFace Short Range，float16，v1 | [`blaze_face_short_range.tflite`](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite) | [MediaPipe BlazeFace Model Card (Short Range)](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)，第 1 页 Apache-2.0；Valentin Bazarevsky（Google），模型卡 Yury Kartynnik、Artsiom Ablavatski。 |
| MagicTouch Interactive Segmenter，float32，v1 | [`magic_touch.tflite`](https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite) | [MagicTouch Model Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf)，Apache-2.0；Google。 |

## HEIC 兼容解码

HEIC 备用解码器为 **libheif-js 1.23.5** ESM/WASM bundle： [`libheif-bundle.mjs`](https://cdn.jsdelivr.net/npm/libheif-js@1.23.5/libheif-wasm/libheif-bundle.mjs)（[备用 CDN](https://unpkg.com/libheif-js@1.23.5/libheif-wasm/libheif-bundle.mjs)）。解码器保持独立，调用代码见 `src/media/heic.ts`。

| 组件 | 固定版本 / 源码 | 许可 |
|---|---|---|
| libheif-js，Kiril Vatev | [1.23.5 / `d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d`](https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d) | [LGPL-3.0](licenses/libheif-js-LGPL-3.0.txt) |
| libheif，struktur AG、Dirk Farin 及贡献者 | [1.23.5 / `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00`](https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00) | [LGPL v3、GPL v3 及上游附带声明](licenses/libheif-COPYING.txt) |
| libde265 HEVC 解码器，struktur AG、Dirk Farin 及贡献者 | [1.0.15 源码](https://github.com/strukturag/libde265/tree/v1.0.15)、[源码发布包](https://github.com/strukturag/libde265/releases/download/v1.0.15/libde265-1.0.15.tar.gz) | [LGPL v3、GPL v3 及上游附带声明](licenses/libde265-COPYING.txt) |
| Emscripten 运行时 | [3.1.61](https://github.com/emscripten-core/emscripten/tree/3.1.61) | [MIT / University of Illinois NCSA 等随附声明](licenses/emscripten-LICENSE.txt) |

对应源码及构建方式：

1. libheif-js 的 [`scripts/install.js`](https://github.com/catdad-experiments/libheif-js/blob/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d/scripts/install.js) 固定获取 [libheif-emscripten v1.23.5 发布物](https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v1.23.5)。发布页明确指向上述 libheif 提交；npm 源码的安装脚本提供将该发布物转换并封装为浏览器 ESM 的完整步骤，`scripts/bundle.js` 内嵌 WASM。
2. 构建仓库为 [libheif-emscripten / `5c8968a44e9c68ae677e24790d77d001ed7fe7cc`](https://github.com/catdad-experiments/libheif-emscripten/tree/5c8968a44e9c68ae677e24790d77d001ed7fe7cc)。可克隆该仓库、检出此提交，再执行 `git submodule update --init --recursive` 取得其锁定的 libheif 源码。
3. 该提交的 [CI 构建配方](https://github.com/catdad-experiments/libheif-emscripten/blob/5c8968a44e9c68ae677e24790d77d001ed7fe7cc/.github/workflows/emscripten.yml) 固定使用 Emscripten **3.1.61**，构建 WASM 分支时设 `USE_WASM=1`、`USE_UNSAFE_EVAL=0`、`USE_TYPESCRIPT=1`。随后执行上游 `scripts/run-ci.sh` 调用 [`build-emscripten.sh`](https://github.com/strukturag/libheif/blob/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/build-emscripten.sh)。该脚本启用并固定下载 **libde265 1.0.15**，关闭多线程、AOM、WebCodecs、OpenJPEG、未压缩编解码支持；上游 CI 未覆盖这些默认值。`dist-prep.sh` 提供发布目录整理步骤并复制原始 `COPYING`。
4. 接收者可按上述开源配方构建兼容解码器，并替换独立资源文件 / 修改 `src/media/heic.ts` 的资源 URL，再按项目构建说明重新生成页面。本项目没有限制对该库的修改或为调试这些修改所需的逆向工程。LGPL 和其引用的 GPL 原文均随许可证文件提供。

## 内置实地录音

环境声与快门录音采用 [CC0 1.0](licenses/CC0-1.0.txt)。作者与原始录音如下：

| 文件 | 原作者 | 原录音 |
|---|---|---|
| `room.mp3` | visionear | [565535](https://freesound.org/people/visionear/sounds/565535/) |
| `wind.mp3` | joseph.larralde | [352721](https://freesound.org/people/joseph.larralde/sounds/352721/) |
| `street.mp3` | Fester993 | [564439](https://freesound.org/people/Fester993/sounds/564439/) |
| `cafe.mp3` | evsecrets | [332271](https://freesound.org/people/evsecrets/sounds/332271/) |
| `rain.mp3` | seth-m | [270349](https://freesound.org/people/seth-m/sounds/270349/) |
| `ocean.mp3` | Noted451 | [531015](https://freesound.org/people/Noted451/sounds/531015/) |
| `forest.mp3` | RealSquink | [788118](https://freesound.org/people/RealSquink/sounds/788118/) |
| `traffic.mp3` | kyles | [177745](https://freesound.org/people/kyles/sounds/177745/) |
| `night.mp3` | visionear | [550313](https://freesound.org/people/visionear/sounds/550313/) |
| `library.mp3` | xkeril | [620683](https://freesound.org/people/xkeril/sounds/620683/) |
| `subway.mp3` | Breviceps | [462658](https://freesound.org/people/Breviceps/sounds/462658/) |
| `shutter.mp3` | Kodack | [271010](https://freesound.org/people/Kodack/sounds/271010/) |

录音经过节选、音量匹配、淡入淡出、48 kHz 双声道重采样与 MP3 编码。原题、下载地址、节选位置、处理方式及校验值见 [`public/audio/manifest.json`](public/audio/manifest.json)。
