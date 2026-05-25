import subprocess
import os
import json


def extract_frames(video_path: str, output_dir: str, start_frame: int = 0, end_frame: int = -1, target_fps: float = -1.0, progress_callback = None) -> int:
    """
    Extract a range of frames from video, optionally resampling to a target FPS.
    Returns total frame count extracted. Renames files sequentially (00001.jpg, 00002.jpg...).
    """
    import shutil
    import time
    os.makedirs(output_dir, exist_ok=True)

    # Clean target folder first
    for f in os.listdir(output_dir):
        fp = os.path.join(output_dir, f)
        if os.path.isfile(fp):
            os.remove(fp)
        elif os.path.isdir(fp):
            shutil.rmtree(fp)

    info = get_video_info(video_path)
    original_fps = info["fps"]

    cmd = ["ffmpeg"]

    # 1. Seek start frame if specified
    if start_frame > 0:
        start_time = start_frame / original_fps
        cmd.extend(["-ss", f"{start_time:.3f}"])

    cmd.extend(["-i", video_path])

    # 2. Resampling rate
    if target_fps > 0 and abs(target_fps - original_fps) > 0.01:
        cmd.extend(["-r", str(target_fps)])

    # 3. Limit duration
    if end_frame > start_frame:
        num_frames = end_frame - start_frame + 1
        duration = num_frames / original_fps
        cmd.extend(["-t", f"{duration:.3f}"])

    cmd.extend([
        "-q:v", "2",
        os.path.join(output_dir, "%05d.jpg"),
        "-y"
    ])

    # Run popen to report progress concurrently
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    while p.poll() is None:
        if progress_callback:
            try:
                count = len([f for f in os.listdir(output_dir) if f.endswith(".jpg")])
                progress_callback(count)
            except Exception:
                pass
        time.sleep(0.1)

    stdout, stderr = p.communicate()
    if p.returncode != 0:
        raise subprocess.CalledProcessError(p.returncode, cmd, output=stdout, stderr=stderr)

    # Rename files to be sequential 00001, 00002...
    extracted_files = sorted([f for f in os.listdir(output_dir) if f.endswith(".jpg")])
    for idx, f in enumerate(extracted_files):
        old_path = os.path.join(output_dir, f)
        new_path = os.path.join(output_dir, f"{idx + 1:05d}.jpg")
        if old_path != new_path:
            if os.path.exists(new_path):
                os.remove(new_path)
            os.rename(old_path, new_path)

    return len([f for f in os.listdir(output_dir) if f.endswith(".jpg")])



def get_video_info(video_path: str) -> dict:
    """Returns fps, total frame count, width, and height."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)
    stream = next(s for s in data["streams"] if s["codec_type"] == "video")
    fps_parts = stream["r_frame_rate"].split("/")
    fps = int(fps_parts[0]) / int(fps_parts[1])
    nb_frames = stream.get("nb_frames", 0)
    if not nb_frames or nb_frames == "N/A":
        # fallback: count duration * fps
        duration = float(stream.get("duration", 0))
        nb_frames = int(duration * fps)
    return {
        "fps": fps,
        "total_frames": int(nb_frames),
        "width": int(stream.get("width", 1920)),
        "height": int(stream.get("height", 1080)),
    }


def export_bw_matte(masks_dir: str, output_path: str, fps: float = 24.0):
    """Export B&W matte video: white subject on black background."""
    cmd = [
        "ffmpeg",
        "-framerate", str(fps),
        "-i", os.path.join(masks_dir, "%05d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y"
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def export_alpha_channel(frames_dir: str, masks_dir: str, output_path: str, fps: float = 24.0):
    """
    Export alpha channel video with transparent background.
    Uses VP9 codec in WebM container which supports alpha.
    """
    # First composite frames with alpha mask using ffmpeg
    cmd = [
        "ffmpeg",
        "-framerate", str(fps), "-i", os.path.join(frames_dir, "%05d.jpg"),
        "-framerate", str(fps), "-i", os.path.join(masks_dir, "%05d.png"),
        "-filter_complex",
        "[0:v][1:v]alphamerge[out]",
        "-map", "[out]",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        output_path.replace(".mp4", ".webm"), "-y"
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        # Fallback: use prores_ks with alpha for .mov
        output_path_mov = output_path.replace(".mp4", ".mov")
        cmd_fallback = [
            "ffmpeg",
            "-framerate", str(fps), "-i", os.path.join(frames_dir, "%05d.jpg"),
            "-framerate", str(fps), "-i", os.path.join(masks_dir, "%05d.png"),
            "-filter_complex", "[0:v][1:v]alphamerge[out]",
            "-map", "[out]",
            "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
            output_path_mov, "-y"
        ]
        subprocess.run(cmd_fallback, check=True, capture_output=True)
        return output_path_mov
    return output_path.replace(".mp4", ".webm")


def export_greenscreen(frames_dir: str, masks_dir: str, output_path: str, fps: float = 24.0):
    """Export subject composited on a solid green background."""
    # Strategy: use mask as alpha, overlay on green
    cmd = [
        "ffmpeg",
        "-framerate", str(fps), "-i", os.path.join(frames_dir, "%05d.jpg"),
        "-framerate", str(fps), "-i", os.path.join(masks_dir, "%05d.png"),
        "-filter_complex",
        # 1) Make mask white = keep, black = discard
        # 2) Use colorchannelmixer to create green background
        # 3) alphamerge original with mask, overlay on green
        "[1:v]format=gray,geq=lum='p(X,Y)':a='p(X,Y)'[alpha];"
        "[0:v][alpha]alphamerge[fg];"
        "color=green:s=1920x1080:r={fps}[bg];"
        "[bg][fg]overlay".format(fps=int(fps)),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y"
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        # Simpler fallback approach
        _export_greenscreen_simple(frames_dir, masks_dir, output_path, fps)


def _export_greenscreen_simple(frames_dir: str, masks_dir: str, output_path: str, fps: float):
    """Simpler greenscreen using Python/PIL for frame-by-frame compositing."""
    import glob
    from PIL import Image
    import numpy as np

    frame_files = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))
    mask_files = sorted(glob.glob(os.path.join(masks_dir, "*.png")))

    if not frame_files:
        return

    # Write composited frames to temp dir
    temp_dir = os.path.join(os.path.dirname(output_path), "temp_green")
    os.makedirs(temp_dir, exist_ok=True)

    green = np.array([0, 255, 0], dtype=np.uint8)

    for i, (frame_path, mask_path) in enumerate(zip(frame_files, mask_files)):
        frame = np.array(Image.open(frame_path).convert("RGB"))
        mask = np.array(Image.open(mask_path).convert("L"))

        # Create green background
        bg = np.full_like(frame, green)

        # Composite: where mask > 128, use frame; else use green
        alpha = (mask > 128)[:, :, np.newaxis]
        composited = np.where(alpha, frame, bg).astype(np.uint8)

        Image.fromarray(composited).save(os.path.join(temp_dir, f"{i+1:05d}.jpg"), quality=95)

    # Encode composited frames to video
    cmd = [
        "ffmpeg",
        "-framerate", str(fps),
        "-i", os.path.join(temp_dir, "%05d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y"
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    # Cleanup temp
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)
