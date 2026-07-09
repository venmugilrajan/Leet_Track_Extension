import os
from PIL import Image, ImageDraw, ImageFont

def generate_icon(size, filename):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw circular gradient background
    # Standard orange to deep indigo/purple gradient
    for r in range(size, 0, -1):
        factor = r / size
        # Linear interpolation between orange (255, 137, 0) and purple (90, 34, 139)
        red = int(255 * (1 - factor) + 90 * factor)
        green = int(137 * (1 - factor) + 34 * factor)
        blue = int(0 * (1 - factor) + 139 * factor)
        
        # Draw concentric circles
        draw.ellipse([size/2 - r/2, size/2 - r/2, size/2 + r/2, size/2 + r/2], 
                     fill=(red, green, blue, 255))
    
    # Draw a inner glowing glass ring
    draw.ellipse([size*0.08, size*0.08, size*0.92, size*0.92], 
                 outline=(255, 255, 255, 60), width=max(1, int(size*0.03)))
    
    # Choose font size and write LT
    try:
        # Load default or standard font
        font = ImageFont.truetype("arial.ttf", int(size * 0.45))
    except IOError:
        font = ImageFont.load_default()
        
    text = "LT"
    # Get text size
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        # Fallback for older Pillow versions
        text_w, text_h = draw.textsize(text, font=font)
        
    x = (size - text_w) / 2
    # Adjust y center slightly for visual alignment
    y = (size - text_h) / 2 - (size * 0.05)
    
    # Draw text with drop shadow
    draw.text((x + size*0.02, y + size*0.02), text, font=font, fill=(0, 0, 0, 80))
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    img.save(filename, "PNG")
    print(f"Generated {filename}")

if __name__ == "__main__":
    sizes = [16, 32, 48, 128]
    for s in sizes:
        generate_icon(s, f"src/assets/icons/icon{s}.png")
