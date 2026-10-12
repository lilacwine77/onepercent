"""Rebuild the editable Blender source and studio previews from the authored GLB.

Run from the repository root:
  C:/Users/user/blender.exe --background --factory-startup --python assets/blender/build_foil_source.py

The deterministic geometry and baked textures originate in src/pack-turntable-source.js;
scripts/export-turntable-master.mjs exports that scene to the uncompressed input GLB.
"""

import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MASTER = HERE / "onepercent-foil-master.glb"
SOURCE = HERE / "onepercent-foil-source.blend"
PREVIEWS = HERE / "previews"
EXPECTED = {"Printed front", "Branded reverse", "Sealed foil edge"}


def aim_at(obj, target=(0, 0, 0)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def camera(name, position):
    data = bpy.data.cameras.new(name)
    data.type = "PERSP"
    data.angle = math.radians(36)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = position
    aim_at(obj)
    return obj


def area_light(name, position, color, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = position
    aim_at(obj)
    return obj


def main():
    if not MASTER.exists():
        raise FileNotFoundError(f"First run node scripts/export-turntable-master.mjs: {MASTER}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MASTER))
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    names = {obj.name for obj in meshes}
    if names != EXPECTED:
        raise AssertionError(f"Unexpected mesh names: {sorted(names)}")
    for obj in meshes:
        obj.data.name = f"{obj.name} · editable topology"

    # Studio equipment is kept outside the export root. All image maps are
    # packed into the .blend so the source opens without companion files.
    world = bpy.data.worlds.new("Warm cream studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (1.55, 1.38, 1.24, 1)
    background.inputs["Strength"].default_value = 0.8
    area_light("Warm softbox", (-4, -7, 5), (1.0, 0.82, 0.64), 850, 5.0)
    area_light("Cyan softbox", (5, -4, 1), (0.55, 0.94, 1.0), 500, 4.0)
    area_light("Violet rim", (-3, 6, -2), (0.82, 0.57, 1.0), 650, 4.5)
    area_light("Rear key", (4, 6, 4), (1, 0.97, 0.85), 600, 5.0)
    cameras = {
        "front": camera("Front reference", (0, -7.1, 0)),
        "quarter": camera("Volume quarter", (4.2, -6.2, 0.7)),
        "rear": camera("Branded rear", (0, 7.1, 0)),
        "profile": camera("Sealed edge", (7.1, 0, 0)),
    }
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.65
    scene.camera = cameras["front"]
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))

    PREVIEWS.mkdir(exist_ok=True)
    for view in ("front", "quarter", "rear", "profile"):
        scene.camera = cameras[view]
        scene.render.filepath = str(PREVIEWS / f"{view}.png")
        bpy.ops.render.render(write_still=True)

    report = {
        "blend": str(SOURCE),
        "master": str(MASTER),
        "objects": sorted(names),
        "triangles": sum(len(obj.data.polygons) for obj in meshes),
        "images_packed": all(image.packed_file is not None for image in bpy.data.images if image.source == "FILE"),
        "previews": [str(PREVIEWS / f"{view}.png") for view in cameras],
    }
    (HERE / "blender-build-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("FOIL_BUILD_REPORT=" + json.dumps(report))


if __name__ == "__main__":
    main()
