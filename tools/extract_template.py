import pypdfium2 as pdfium
import sys

def convert_ai_to_png(ai_path, png_path):
    try:
        print(f"Loading {ai_path}...")
        doc = pdfium.PdfDocument(ai_path)
        print(f"Number of pages: {len(doc)}")
        if len(doc) == 0:
            print("PDF has no pages.")
            return False
        
        # Render the first page
        page = doc[0]
        # Render at 150 DPI or higher for good quality
        bitmap = page.render(
            scale=2,  # 2x scaling for higher resolution
        )
        pil_image = bitmap.to_pil()
        pil_image.save(png_path)
        print(f"Successfully saved rendered template to {png_path}")
        return True
    except Exception as e:
        print(f"Error during conversion: {e}")
        return False

if __name__ == "__main__":
    ai_file = "template.ai"
    png_file = "template.png"
    convert_ai_to_png(ai_file, png_file)
