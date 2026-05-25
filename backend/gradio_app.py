"""
Gradio debug interface — mounted inside FastAPI at /gradio.

This is a developer-only UI for testing SAM 2 directly without the React frontend.
End users will never see this screen.
"""

import gradio as gr
import base64
import io
import numpy as np
from PIL import Image


def create_gradio_app():
    """Build and return the Gradio Blocks app."""

    with gr.Blocks(title="RotoAI Debug", theme=gr.themes.Soft()) as app:
        gr.Markdown("## 🎬 RotoAI — SAM 2 Debug Interface")
        gr.Markdown(
            "> Developer tool. Upload an image and click to generate a mask preview."
        )

        with gr.Row():
            with gr.Column(scale=1):
                image_input = gr.Image(
                    label="Input Frame (upload any JPEG/PNG)",
                    type="pil"
                )
                point_x = gr.Number(label="Click X (px)", value=0)
                point_y = gr.Number(label="Click Y (px)", value=0)
                run_btn = gr.Button("Preview Mask", variant="primary")

            with gr.Column(scale=1):
                mask_output = gr.Image(label="SAM 2 Mask Output", type="pil")
                overlay_output = gr.Image(label="Mask Overlay", type="pil")
                status_text = gr.Textbox(label="Status", value="Ready")

        def run_preview(image: Image.Image, x: float, y: float):
            if image is None:
                return None, None, "⚠️ Please upload an image first."

            try:
                from services.sam2_service import predict_single_frame
                import tempfile, os

                # Save PIL image to temp file
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                    image.save(tmp.name, "JPEG")
                    tmp_path = tmp.name

                mask_arr = predict_single_frame(
                    tmp_path,
                    points=[[int(x), int(y)]],
                    labels=[1]
                )
                os.unlink(tmp_path)

                mask_img = Image.fromarray(mask_arr)

                # Create overlay: purple tint on original
                orig_rgba = image.convert("RGBA")
                overlay = Image.new("RGBA", image.size, (108, 99, 255, 0))
                mask_alpha = Image.fromarray((mask_arr * 0.5).astype(np.uint8)).convert("L")
                overlay.putalpha(mask_alpha)
                composited = Image.alpha_composite(orig_rgba, overlay).convert("RGB")

                return mask_img, composited, "✅ Mask generated successfully"

            except Exception as e:
                return None, None, f"❌ Error: {str(e)}"

        run_btn.click(
            fn=run_preview,
            inputs=[image_input, point_x, point_y],
            outputs=[mask_output, overlay_output, status_text]
        )

    return app
