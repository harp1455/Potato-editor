# 그래프와 가중치(.onnx_data)가 따로 있는 모델: 같은 폴더에 원래 이름으로 놓고 읽어 fp16w로 한 파일에 저장
import os, shutil, subprocess, sys, tempfile
graph, data, dst = sys.argv[1], sys.argv[2], sys.argv[3]
with tempfile.TemporaryDirectory() as d:
    shutil.copy(graph, os.path.join(d, 'model.onnx')); shutil.copy(data, os.path.join(d, 'model.onnx_data'))
    import onnx
    m = onnx.load(os.path.join(d, 'model.onnx'))  # 같은 폴더의 model.onnx_data를 같이 읽어요
    onnx.save(m, os.path.join(d, 'one.onnx'))
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fp16w.py'), os.path.join(d, 'one.onnx'), dst], check=True)
