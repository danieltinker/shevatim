"""ONNX model wrappers (isnet matte, u2net cloth parsing, SAM vit_b) used by the picture pipeline.
Model files live in ~/.u2net (downloaded from github.com/danielgatis/rembg releases v0.0.0); never committed."""
import os, numpy as np, cv2, onnxruntime as ort
MD = os.path.expanduser('~/.u2net')
_S = {}
def sess(name, threads=1):
    if name not in _S:
        o = ort.SessionOptions(); o.intra_op_num_threads = threads; o.inter_op_num_threads = 1; o.enable_cpu_mem_arena = False; o.enable_mem_pattern = False
        _S[name] = ort.InferenceSession(os.path.join(MD, name + '.onnx'), o, providers=['CPUExecutionProvider'])
    return _S[name]

def isnet(rgb, threads=1):
    s = sess('isnet-general-use', threads); h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0 - 0.5
    y = s.run(None, {s.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]
    y = (y - y.min()) / (y.max() - y.min() + 1e-6)
    return cv2.resize(y, (w, h), interpolation=cv2.INTER_LINEAR)

def cloth(rgb, threads=1):
    """returns label map: 0 bg, 1 upper, 2 lower, 3 full-body garment"""
    s = sess('u2net_cloth_seg', threads); h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (768, 768), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    y = s.run(None, {s.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    lab = y.argmax(0).astype(np.uint8)
    return cv2.resize(lab, (w, h), interpolation=cv2.INTER_NEAREST)

class Sam:
    """SAM vit_b (quantised encoder/decoder, samexporter layout): long side -> 1024, pad, ImageNet-style normalisation."""
    def __init__(self, rgb, threads=1):
        self.enc = sess('vit_b-encoder-quant', threads); self.dec = sess('vit_b-decoder-quant', threads)
        self.h, self.w = rgb.shape[:2]; self.sc = 1024.0 / max(self.h, self.w)
        nh, nw = int(self.h * self.sc + 0.5), int(self.w * self.sc + 0.5)
        x = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA).astype(np.float32)
        x = (x - np.array([123.675, 116.28, 103.53], np.float32)) / np.array([58.395, 57.12, 57.375], np.float32)
        p = np.zeros((1024, 1024, 3), np.float32); p[:nh, :nw] = x
        self.emb = self.enc.run(None, {'x': p.transpose(2, 0, 1)[None]})[0]
    def mask(self, pos, neg=(), box=None, prev=None):
        """pos/neg: lists of (x, y) in original pixels. returns (logit mask at original size, iou, low_res logits)"""
        pts = list(pos) + list(neg); lab = [1] * len(pos) + [0] * len(neg)
        if box is not None: pts += [(box[0], box[1]), (box[2], box[3])]; lab += [2, 3]
        else: pts += [(0, 0)]; lab += [-1]
        mi = np.zeros((1, 1, 256, 256), np.float32) if prev is None else prev
        m, iou, low = self.dec.run(None, {
            'image_embeddings': self.emb, 'point_coords': (np.array(pts, np.float32) * self.sc)[None],
            'point_labels': np.array(lab, np.float32)[None], 'mask_input': mi,
            'has_mask_input': np.array([0 if prev is None else 1], np.float32),
            'orig_im_size': np.array([self.h, self.w], np.float32)})
        return m, iou, low
