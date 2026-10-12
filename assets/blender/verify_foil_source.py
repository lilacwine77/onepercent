"""Fresh-open gate for the packed, editable foil source .blend."""

import bpy
import json
import math

expected = {"Printed front", "Branded reverse", "Sealed foil edge"}
meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
names = {obj.name for obj in meshes}
if names != expected:
    raise AssertionError(f"Expected {sorted(expected)}, found {sorted(names)}")
triangles = sum(len(obj.data.polygons) for obj in meshes)
if triangles != 366604:
    raise AssertionError(f"Unexpected topology: {triangles} triangles")
for obj in meshes:
    if obj.name != "Sealed foil edge" and not obj.data.uv_layers:
        raise AssertionError(f"Missing UVs: {obj.name}")
    if any(not all(math.isfinite(v) for v in vertex.co) for vertex in obj.data.vertices):
        raise AssertionError(f"Non-finite vertex: {obj.name}")
materials = [material for obj in meshes for material in obj.data.materials if material]
if len(materials) < 3 or any(not material.node_tree or not material.node_tree.nodes for material in materials):
    raise AssertionError("Expected node-based front, reverse, and edge materials")
images = [image for image in bpy.data.images if image.source == "FILE"]
unpacked = [image.name for image in images if image.packed_file is None]
if unpacked:
    raise AssertionError(f"External images remain: {unpacked}")
report = {
    "source": bpy.data.filepath,
    "meshes": sorted(names),
    "triangles": triangles,
    "packed_images": len(images),
    "material_slots": len(materials),
    "finite_vertices": True,
    "world_bounds": {
        obj.name: {
            axis: [
                round(min((obj.matrix_world @ vertex.co)[coordinate] for vertex in obj.data.vertices), 4),
                round(max((obj.matrix_world @ vertex.co)[coordinate] for vertex in obj.data.vertices), 4),
            ]
            for axis, coordinate in (("x", 0), ("y", 1), ("z", 2))
        }
        for obj in meshes
    },
    "cameras": sorted(obj.name for obj in bpy.data.objects if obj.type == "CAMERA"),
}
print("FOIL_FRESH_OPEN=" + json.dumps(report))
