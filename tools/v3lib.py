"""Shared helpers for the v3 asset pipeline: background keying + connected components on the AI sheets in design/."""
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage


def key_bg(im, light=195, neutral=18, fringe=1):
    """Remove a checkerboard / white background: neutral light pixels that connect to the image border become
    transparent (interior light pixels enclosed by outlines survive). `fringe` px of anti-aliased edge is trimmed.
    Existing alpha is preserved — never force opaque — so sheets that are already keyed keep soft edges."""
    rgba = np.array(im.convert('RGBA'))
    rgb = rgba[:, :, :3].astype(int)
    alpha = rgba[:, :, 3].copy()
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    bg = (mx - mn < neutral) & (mn > light)
    lab, _ = ndimage.label(bg)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    mask = np.isin(lab, border[border > 0])
    if fringe:
        mask = ndimage.binary_dilation(mask, iterations=fringe)
    alpha[mask] = 0
    out = np.dstack([rgb.astype(np.uint8), alpha])
    return Image.fromarray(out, 'RGBA')


def components(im, min_size=18, dilate=6):
    """Bounding boxes of opaque blobs (merged when within `dilate` px). im: RGBA. Returns [(x0,y0,x1,y1)] sorted by row then x."""
    a = np.array(im)[:, :, 3] > 40
    if dilate:
        a = ndimage.binary_dilation(a, iterations=dilate)
    lab, n = ndimage.label(a)
    boxes = []
    for sl in ndimage.find_objects(lab):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if x1 - x0 < min_size or y1 - y0 < min_size:
            continue
        boxes.append((max(0, x0 - 1), max(0, y0 - 1), min(im.width, x1 + 1), min(im.height, y1 + 1)))
    boxes.sort(key=lambda b: (round(b[1] / 80), b[0]))
    return boxes


def tight(im, thr=40):
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > thr)
    if not len(xs):
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def contact(im, boxes, path, scale=0.5):
    s = im.convert('RGB').resize((int(im.width * scale), int(im.height * scale)))
    d = ImageDraw.Draw(s)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        d.rectangle([x0 * scale, y0 * scale, x1 * scale, y1 * scale], outline=(255, 0, 0))
        d.rectangle([x0 * scale, y0 * scale, x0 * scale + 26, y0 * scale + 12], fill=(0, 0, 0))
        d.text((x0 * scale + 2, y0 * scale), str(i), fill=(255, 255, 0))
    s.save(path)
