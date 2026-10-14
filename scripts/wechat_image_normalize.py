"""Bounded local image previews shared by received and collected stickers."""
import base64,hashlib,io
from PIL import Image,ImageOps

def normalize_image(raw, animated=False):
    if not raw or len(raw) > 8 * 1024 * 1024:
        raise RuntimeError('IMAGE_TOO_LARGE_OR_EMPTY')
    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > 40_000_000:
            raise RuntimeError('IMAGE_PIXEL_LIMIT')
        if animated and getattr(source, 'is_animated', False):
            # Bound decoded pixels and frames. A static sheet conveys sampled
            # animation content without repeatedly sending entire animations.
            budget = min(128, max(1, 80_000_000 // (source.width * source.height)))
            count=min(getattr(source,'n_frames',1),budget)
            frames=[]
            for index in dict.fromkeys((0,(count-1)//2,count-1)):
                source.seek(index)
                frame = source.convert('RGBA')
                frame.thumbnail((384, 384))
                background = Image.new('RGB', frame.size, 'white')
                background.paste(frame, mask=frame.getchannel('A'))
                frames.append(background)
            image = Image.new('RGB', (sum(f.width for f in frames), max(f.height for f in frames)), 'white')
            x = 0
            for frame in frames:
                image.paste(frame, (x, 0)); x += frame.width
        else:
            image = ImageOps.exif_transpose(source).convert('RGB')
        image.thumbnail((1280, 1280))
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=85, optimize=True)
        data = output.getvalue()
        if len(data) > 768 * 1024:
            output = io.BytesIO()
            image.save(output, format='JPEG', quality=65, optimize=True)
            data = output.getvalue()
        if len(data) > 768 * 1024:
            raise RuntimeError('NORMALIZED_IMAGE_TOO_LARGE')
        return {'b64': base64.b64encode(data).decode('ascii'), 'mime': 'image/jpeg',
            'width': image.width, 'height': image.height, 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}

