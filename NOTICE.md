# 구성 요소와 라이선스

```
감자 편집기 — 함께 쓰는 구성 요소
- onnxruntime-web 1.31.1 : Copyright (c) Microsoft Corporation, MIT License (https://github.com/microsoft/onnxruntime)
- deepghs/anime_censor_detection censor_detect_v1.0_s, v1.0_n : MIT License (https://huggingface.co/deepghs/anime_censor_detection)
    바꾼 점: 가중치를 16비트로 줄여 저장, 계산은 32비트
- 01miku/anime-nsfw-segm-yolo26 nano, medium : MIT License (https://huggingface.co/01miku/anime-nsfw-segm-yolo26)
    바꾼 점: 16비트 가중치 그대로 두고 계산만 32비트로 바꿔 저장
- MobileSAM : Apache License 2.0 (https://github.com/ChaoningZhang/MobileSAM, 전문 https://www.apache.org/licenses/LICENSE-2.0)
    ONNX 변환: Acly/MobileSAM, MIT License (https://huggingface.co/Acly/MobileSAM)
    바꾼 점: 가중치를 16비트로 줄여 저장
- skytnt/anime-seg isnetis : Apache License 2.0 (https://huggingface.co/skytnt/anime-seg)  ※ 설치판 AI 팩
    바꾼 점: 가중치를 16비트로 줄여 저장
- Real-ESRGAN RealESRGAN_x4plus_anime_6B, 4B32F : BSD-3-Clause, Copyright (c) 2021 Xintao Wang (https://github.com/xinntao/Real-ESRGAN)
    ONNX 변환: deepghs/imgutils-models, MIT License. 바꾼 점: 가중치를 16비트로 줄여 저장  ※ 설치판 AI 팩
- mp4-muxer 5.2.2 : Copyright (c) 2023 Vanilagy, MIT License (https://github.com/Vanilagy/mp4-muxer)  ※ 움짤 MP4 저장
- Animate.css 4.1.1 : Copyright (c) 2020 Daniel Eden, MIT License (https://github.com/animate-css/animate.css)  ※ 움짤 글자 움직임
    바꾼 점: @keyframes를 숫자 데이터로 옮겨 캔버스에서 계산
- gl-transitions : Copyright (c) 2017-present gl-transitions contributors, MIT License (https://github.com/gl-transitions/gl-transitions)
    MIT로 공개된 장면 넘김 196가지 (지은이는 각 넘김에 적힌 대로)  ※ 움짤 특수 장면 넘김
참고: 두 찾기 모델은 Ultralytics YOLO 계열 구조예요. Ultralytics는 자기 도구로 학습한 모델에 AGPL-3.0이 적용된다고 보고 있어서,
      이 프로그램을 팔거나 상업 제품에 넣으려면 따로 확인이 필요해요.

MIT License (위에서 MIT로 적힌 구성 요소마다, 각 저작권자)
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH
THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

설치판 껍데기는 Tauri(MIT 또는 Apache-2.0)로 만들었어요.
