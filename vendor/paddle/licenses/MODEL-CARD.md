---
language:
- en
- zh
- multilingual

tags:
- ocr
- onnx
- vision-language
- paddleocr
- table-recognition
- nncf
- gptq
license: apache-2.0

---

# PaddleOCR-VL-1.5 ONNX Optimized (Quantized)

This repository provides the **ONNX** version of [PaddleOCR-VL-1.5](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5), specifically optimized for CPU inference. The models have been quantized using **Intel® ONNX Neural Compressor (INC)** and **NNCF** to significantly reduce memory usage and increase inference speed.

## 🛠 Model Files & Quantization

This project offers multiple levels of quantization so you can choose the best balance between speed and accuracy for your hardware.

### 1. Vision Encoder & Multi-modal Projector
The vision component handles the initial image processing and maps visual features to the language space.
*   **`vision_encoder.onnx`**: Full FP32 precision.
*   **`vision_encoder_q8.onnx`**: 8-bit dynamic quantized version.
*   **`vision_encoder_q4.onnx`**: 4-bit weight-only quantization, compressed using **NNCF** (Data-free).

### 2. Decoder (Language Model)
The autoregressive decoder responsible for generating the text/structured output.
*   **`decoder.onnx`**: Full FP32 precision language model.
*   **`decoder_q8.onnx`**: 8-bit dynamic quantized version.
*   **`decoder_q4.onnx`**: 4-bit quantized version using the **GPTQ algorithm** via the **ONNX Neural Compressor**.

### 3. Embedding
*   **`embed.onnx`**: The shared embedding layer required for token-to-vector conversion.

---

### Key Quantization Techniques
*   **GPTQ (Generative Pre-trained Transformer Quantization)**: Applied to the 4-bit decoder to maintain high accuracy in text generation by minimizing the weight-error during compression.
*   **NNCF Weight-Only Quantization**: Applied to the vision encoder to reduce the initial "prefill" time (Time to First Token) without requiring a calibration dataset.

---

## 💻 How to Use : 
Check out this colab notebook [Demo](https://colab.research.google.com/drive/13-Wa3Kb88TeItJfj2RHMTCdQ2BpWEjOC?usp=sharing) , I used OpenVINO backend ,but you can used what ever backend depends on the hardware [onnx providers](https://onnxruntime.ai/docs/execution-providers/)
