"""Create the editable carousel source and inspect its independent GLB import.

Run after build_carousel.mjs:
  blender --background --factory-startup --python assets/blender/carousel/build_source.py
  blender --background --factory-startup --python assets/blender/carousel/build_source.py -- --fresh
"""
import bpy
import bmesh
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MASTER = HERE / "onepercent-carousel-master.glb"
SOURCE = HERE / "onepercent-carousel.blend"
EVIDENCE = ROOT / "artifacts" / "carousel-volume"
NAMES = {"Printed front", "Branded reverse", "Sealed foil edge"}
FRESH = "--fresh" in sys.argv


def metrics(meshes):
    report = {"parts": [], "triangles": 0, "nonfinite": 0, "degenerate_faces": 0}
    points = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        tris = len(obj.data.loop_triangles)
        verts = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        points.extend(verts)
        nonfinite = sum(not all(math.isfinite(v) for v in point) for point in verts)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        degenerates = sum(face.calc_area() < 1e-12 for face in bm.faces)
        boundaries = sum(edge.is_boundary for edge in bm.edges)
        bm.free()
        report["triangles"] += tris
        report["nonfinite"] += nonfinite
        report["degenerate_faces"] += degenerates
        report["parts"].append({"name": obj.name, "triangles": tris,
            "vertices": len(verts), "uv_layers": len(obj.data.uv_layers),
            "boundary_edges": boundaries, "materials": [m.name for m in obj.data.materials],
            "smooth_faces": sum(face.use_smooth for face in obj.data.polygons)})
    lower = [min(point[i] for point in points) for i in range(3)]
    upper = [max(point[i] for point in points) for i in range(3)]
    report["blender_bounds"] = {"min": lower, "max": upper}
    report["dimensions"] = [upper[i] - lower[i] for i in range(3)]
    report["blender_version"] = bpy.app.version_string
    assert report["nonfinite"] == 0
    assert report["degenerate_faces"] == 0, report
    assert 20000 <= report["triangles"] <= 52000, report
    assert {obj.name for obj in meshes} == NAMES
    assert {material.name for obj in meshes for material in obj.data.materials} == NAMES
    assert all(len(obj.data.uv_layers) for obj in meshes if obj.name != "Sealed foil edge")
    return report


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_light(name, position, energy, width, height, color, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "RECTANGLE"
    data.size = width
    data.size_y = height
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    aim(obj, target)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_path = EVIDENCE / "fresh-import.glb" if FRESH else MASTER
    bpy.ops.import_scene.gltf(filepath=str(import_path))
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    report = metrics(meshes)
    report["input_sha256"] = hashlib.sha256(import_path.read_bytes()).hexdigest()
    report["source"] = str(import_path)
    center = Vector(tuple((a+b)/2 for a,b in zip(report["blender_bounds"]["min"], report["blender_bounds"]["max"])))
    world = bpy.data.worlds.new("Cream studio")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.69, .61, .55, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .65
    add_light("Broad warm key", (-4, -5, 5), 950, 4, 6, (1,.94,.85), center)
    add_light("Long silver strip", (5, -3, 2), 1150, 1.6, 6, (.85,.94,1), center)
    add_light("Upper bounce", (0, 0, 6), 600, 5, 3, (1,1,1), center)
    add_light("Reverse softbox", (-3, 5, 3), 1000, 5, 5, (1,.96,.89), center)
    cameras = {}
    positions = {"front": (0,-9.5,0), "quarter": (4.6,-8.1,.75),
        "back": (0,9.5,0), "left": (-9.5,0,0), "right": (9.5,0,0), "top": (0,-.01,9.5)}
    for name, offset in positions.items():
        data = bpy.data.cameras.new(f"Carousel {name}")
        data.type = "ORTHO"
        data.ortho_scale = 4.55
        cam = bpy.data.objects.new(f"Carousel {name}", data)
        scene.collection.objects.link(cam)
        cam.location = center + Vector(offset)
        aim(cam, center)
        cameras[name] = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -.55
    scene.camera = cameras["quarter"]
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    if not FRESH:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
    prefix = "fresh" if FRESH else "authored"
    (EVIDENCE / f"{prefix}-metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    # Final multiview evidence is rendered from the fresh decoded runtime import.
    views = list(positions) if FRESH else ["quarter"]
    for view in views:
        scene.camera = cameras[view]
        scene.render.filepath = str(EVIDENCE / f"{prefix}-{view}.png")
        bpy.ops.render.render(write_still=True)
    if FRESH:
        clay = bpy.data.materials.new("Inspection clay")
        bsdf = clay.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (.48,.50,.54,1)
        bsdf.inputs["Metallic"].default_value = .12
        bsdf.inputs["Roughness"].default_value = .40
        for obj in meshes:
            obj.data.materials.clear()
            obj.data.materials.append(clay)
        for view in ["front", "quarter", "right"]:
            scene.camera = cameras[view]
            scene.render.filepath = str(EVIDENCE / f"clay-{view}.png")
            bpy.ops.render.render(write_still=True)
    print("CAROUSEL_ASSET_REPORT=" + json.dumps(report))


if __name__ == "__main__":
    main()
