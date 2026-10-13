import xml.etree.ElementTree as ET
from importlib.metadata import version

from reading.recognition import Box, Reading

NAMESPACE = "http://www.loc.gov/standards/alto/ns-v4#"


def placed(box: Box) -> dict[str, str]:
    x0, y0, x1, y1 = box
    return {"HPOS": str(x0), "VPOS": str(y0), "WIDTH": str(x1 - x0), "HEIGHT": str(y1 - y0)}


def description(root: ET.Element) -> None:
    described = ET.SubElement(root, "Description")
    ET.SubElement(described, "MeasurementUnit").text = "pixel"
    processing = ET.SubElement(described, "Processing", {"ID": "OCR_0"})
    ET.SubElement(processing, "processingCategory").text = "contentGeneration"
    ET.SubElement(processing, "processingStepDescription").text = "Text line recognition"
    software = ET.SubElement(processing, "processingSoftware")
    ET.SubElement(software, "softwareName").text = "kraken"
    ET.SubElement(software, "softwareVersion").text = version("kraken")


def alto_of(reading: Reading) -> str:
    root = ET.Element("alto", {"xmlns": NAMESPACE})
    description(root)
    size = {"WIDTH": str(reading.width), "HEIGHT": str(reading.height)}
    page = ET.SubElement(ET.SubElement(root, "Layout"), "Page", {"ID": "page_0", "PHYSICAL_IMG_NR": "0", **size})
    space = ET.SubElement(page, "PrintSpace", {"HPOS": "0", "VPOS": "0", **size})
    if reading.lines:
        block = ET.SubElement(space, "TextBlock", {"ID": "block_0"})
        for line in reading.lines:
            element = ET.SubElement(block, "TextLine", {"ID": f"line_{line.row}", **placed(line.box)})
            for index, word in enumerate(line.words, start=1):
                ET.SubElement(
                    element,
                    "String",
                    {
                        "ID": f"word_{line.row}_{index}",
                        "CONTENT": word.text,
                        **placed(word.box),
                        "WC": f"{word.confidence:.4f}",
                    },
                )
    return ET.tostring(root, encoding="unicode", xml_declaration=True)
