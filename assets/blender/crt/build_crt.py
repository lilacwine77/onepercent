"""Deterministic smooth CRT asset. Blender 5.2, run with --background --factory-startup --python.

Optional arguments: --graybox; --render; --poster; --skip-export.
Blender X right / -Y front / Z up; glTF X right / +Z front / Y up.
"""
from pathlib import Path
import bpy, bmesh, math, json, sys, hashlib
from mathutils import Vector, Matrix

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / 'onepercent-crt-source.blend'
MASTER = HERE / 'onepercent-crt-master.glb'
TEXTURE = ROOT / 'public/assets/crt-screen.png'
POSTER = ROOT / 'public/assets/crt-poster.png'
GRAY = '--graybox' in sys.argv
SEG = 16
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.cycles.use_adaptive_sampling=True
scene.cycles.adaptive_threshold=.03
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX'; prefs.get_devices()
    for dev in prefs.devices: dev.use=dev.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception: pass
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.render.resolution_x=1400; scene.render.resolution_y=1400
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.world.color=(.15,.15,.15)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.64,.69,.78,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.32

root=bpy.data.objects.new('CRT_Root',None)
scene.collection.objects.link(root)
root['asset']='onepercent-crt'; root['version']=1
root['front_axis']='Blender -Y / glTF +Z'

def mat(name,color,rough=.4,metal=0,coat=0):
    m=bpy.data.materials.new(name)
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metal
    p.inputs['Coat Weight'].default_value=coat
    p.inputs['Coat Roughness'].default_value=.18
    return m

case=mat('CRT_Case',(.77,.728,.633),.29,0,.2)
rear=mat('CRT_RearCase',(.64,.607,.532),.36,0,.1)
recess=mat('CRT_Recess',(.56,.525,.448),.31)
seam=mat('CRT_Seam',(.145,.13,.105),.53)
dark=mat('CRT_Graphite',(.035,.039,.042),.47)
metal=mat('CRT_Metal',(.32,.34,.33),.26,.8)
logo=mat('CRT_Logo',(.20,.188,.153),.3,.25)
led=mat('CRT_StatusLED',(.42,.92,.23),.2)
led.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(.30,.9,.12,1)
led.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.7
screenmat=mat('CRT_ScreenMaterial',(.04,.045,.065),.14,0,.7)
sp=screenmat.node_tree.nodes['Principled BSDF']
sp.inputs['Coat Roughness'].default_value=.09
sp.inputs['IOR'].default_value=1.48
if TEXTURE.exists():
    tex=screenmat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image=bpy.data.images.load(str(TEXTURE)); tex.image.pack()
    tex.interpolation='Linear'
    screenmat.node_tree.links.new(tex.outputs['Color'],sp.inputs['Base Color'])
    screenmat.node_tree.links.new(tex.outputs['Color'],sp.inputs['Emission Color'])
    sp.inputs['Emission Strength'].default_value=.65
    sp.inputs['Base Color'].default_value=(1,1,1,1)
if GRAY:
    for m in [case,rear,recess,seam,dark,metal,logo]:
        p=m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value=(.48,.48,.48,1)
        p.inputs['Roughness'].default_value=.55

def finish(name,verts,faces,material,smooth=True,uvs=None):
    mesh=bpy.data.meshes.new(name+'Mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    bm=bmesh.new(); bm.from_mesh(mesh); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    o=bpy.data.objects.new(name,mesh); scene.collection.objects.link(o); o.parent=root
    o.data.materials.append(material); o['managed']=True
    for p in mesh.polygons: p.use_smooth=smooth
    if uvs:
        uv=mesh.uv_layers.new(name='UVMap')
        for poly in mesh.polygons:
            for li in poly.loop_indices: uv.data[li].uv=uvs[mesh.loops[li].vertex_index]
    return o

def outline(w,h,r,cz=0):
    pts=[]
    # Counter-clockwise in X/Z, beginning on upper right.
    for cx,cz0,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
        for j in range(SEG):
            t=math.radians(start+j*90/SEG)
            pts.append((cx+r*math.cos(t),cz+cz0+r*math.sin(t)))
    return pts

def loft(name,sections,material,closed=True,caps=False):
    verts=[]; n=SEG*4
    for y,w,h,r,z in sections:
        verts.extend((x,y,zz) for x,zz in outline(w,h,r,z))
    faces=[]
    rowcount=len(sections) if closed else len(sections)-1
    for k in range(rowcount):
        a=k*n; b=((k+1)%len(sections))*n
        for i in range(n): faces.append((a+i,a+(i+1)%n,b+(i+1)%n,b+i))
    if caps: faces.extend([tuple(reversed(range(n))),tuple((len(sections)-1)*n+i for i in range(n))])
    return finish(name,verts,faces,material)

# Profile is continuous: rounded outside, flat face, inset moulding and sloped screen reveal.
bezel=loft('CRT_Bezel',[
    (-.82,4.08,3.38,.24,0),(-1.15,4.2,3.5,.26,0),
    (-1.30,4.19,3.49,.25,0),(-1.385,4.14,3.44,.235,0),
    (-1.435,4.04,3.34,.21,0),(-1.45,3.97,3.27,.19,0),
    (-1.45,3.67,2.88,.165,.13),(-1.442,3.625,2.835,.157,.13),
    (-1.425,3.595,2.805,.150,.13),(-1.395,3.595,2.805,.150,.13),
    (-1.375,3.58,2.79,.148,.13),(-1.372,3.54,2.75,.142,.13),
    (-1.385,3.505,2.715,.137,.13),(-1.39,3.485,2.695,.133,.13),
    (-1.35,3.455,2.665,.13,.13),(-1.14,3.325,2.49,.15,.14),
    (-1.08,3.30,2.47,.15,.14),(-.80,3.30,2.47,.15,.14),
],case)
# The inset mould line uses the existing recess faces, so there is no overlay
# intersecting the ivory bezel when positions are quantized for the browser.
bezel.data.materials.append(recess)
for polygon in bezel.data.polygons:
    if 9*SEG*4 <= polygon.index < 10*SEG*4: polygon.material_index=1
shell=loft('CRT_RearShell',[
    (-.79,4.073,3.373,.245,0),(-.72,4.085,3.385,.25,0),
    (-.52,4.07,3.37,.26,-.015),(-.40,4.01,3.30,.27,-.03),
    (.62,3.28,2.81,.22,-.17),(1.13,3.04,2.61,.20,-.21),
    (1.21,2.96,2.53,.18,-.21),(1.25,2.85,2.42,.16,-.21),
],rear,closed=False,caps=True)
loft('CRT_CaseSplit',[
    (-.837,4.076,3.376,.245,0),(-.80,4.076,3.376,.245,0),
    (-.80,4.05,3.35,.242,0),(-.837,4.05,3.35,.242,0)],seam)

# A regular quad grid follows the rounded rectangle without an alpha-cutout plane.
verts=[]; uvs=[]; faces=[]; nx=64; nz=48; sw=3.34; sh=2.50; radius=.165
for j in range(nz+1):
    z0=(j/nz-.5)*sh
    if abs(z0)>sh/2-radius:
        ex=sw/2-radius+math.sqrt(max(0,radius*radius-(abs(z0)-(sh/2-radius))**2))
    else: ex=sw/2
    for i in range(nx+1):
        x=(i/nx*2-1)*ex
        y=-1.145-.19*(1-(x/(sw/2))**2)*(1-(z0/(sh/2))**2)
        verts.append((x,y,z0+.14)); uvs.append((x/sw+.5,z0/sh+.5))
for j in range(nz):
    for i in range(nx):
        a=j*(nx+1)+i; faces.append((a,a+1,a+nx+2,a+nx+1))
screen=finish('CRT_Screen',verts,faces,screenmat,uvs=uvs)
# Force open screen normals toward the front; no second transparent plane / z-fighting.
for p in screen.data.polygons:
    if p.normal.y>0:
        bm=bmesh.new(); bm.from_mesh(screen.data); bmesh.ops.reverse_faces(bm,faces=list(bm.faces)); bm.to_mesh(screen.data); bm.free(); break
screen['role']='curved screen, full artwork UVs; reactive shader target'

def box(name,loc,scale,material,bevel=.03,segments=4):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object; o.name=name; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.parent=root; o.data.materials.append(material); o['managed']=True
    if bevel:
        mod=o.modifiers.new('Manufactured edge','BEVEL'); mod.width=bevel; mod.segments=segments
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    for p in o.data.polygons:p.use_smooth=True
    return o

def cylinder(name,loc,radius,depth,material,axis='Y',vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=bpy.context.object; o.name=name; o.parent=root
    if axis=='Y':o.rotation_euler[0]=math.pi/2
    elif axis=='X':o.rotation_euler[1]=math.pi/2
    o.data.materials.append(material)
    b=o.modifiers.new('Soft rim','BEVEL'); b.width=min(.008,radius*.2,depth*.2); b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    for p in o.data.polygons:p.use_smooth=True
    return o

if not GRAY:
    # Flush lower control insert with a slim perimeter reveal.
    box('CRT_ControlPanelRecess',(.98,-1.418,-1.413),(1.20,.045,.28),recess,.042,6)
    box('CRT_ControlPanel',(.98,-1.442,-1.406),(1.17,.032,.255),case,.039,6)
    box('CRT_RockerSocket',(.76,-1.465,-1.411),(.38,.024,.114),seam,.05,6)
    box('CRT_Rocker',(.76,-1.484,-1.410),(.34,.072,.086),case,.037,6)
    box('CRT_PowerSocket',(1.354,-1.465,-1.411),(.211,.024,.114),seam,.05,6)
    box('CRT_PowerButton',(1.354,-1.485,-1.410),(.177,.067,.084),case,.035,6)
    cylinder('CRT_LED_Rim',(1.100,-1.464,-1.411),.025,.022,seam)
    cylinder('CRT_LED',(1.100,-1.480,-1.411),.016,.022,led)
    box('CRT_InfraredWindow',(1.335,-1.452,-1.190),(.13,.009,.044),dark,.004,3)
    # Front mark is geometric and remains readable as the camera moves.
    curve=bpy.data.curves.new('CRT_1percentGlyph','FONT'); curve.body='1%'; curve.size=.14
    curve.extrude=.0018; curve.bevel_depth=.0007; curve.bevel_resolution=2; curve.resolution_u=10
    curve.align_x='LEFT'; curve.align_y='CENTER'; curve.space_character=1.05
    label=bpy.data.objects.new('CRT_Brand',curve); scene.collection.objects.link(label)
    label.location=(-1.70,-1.452,-1.425); label.rotation_euler=(math.pi/2,0,0); label.parent=root
    label.data.materials.append(logo)
    # Bottom ventilation rail is a genuine separated louvre structure on a dark inset.
    box('CRT_BottomVentRecess',(0,-1.232,-1.724),(3.42,.27,.05),seam,.020,4)
    box('CRT_BottomVentFrontTrim',(0,-1.377,-1.727),(3.51,.040,.055),rear,.016,4)
    box('CRT_BottomVentRearTrim',(0,-1.087,-1.727),(3.51,.040,.055),rear,.016,4)
    for side in [-1,1]:
        box('CRT_BottomVentEndTrim',(side*1.745,-1.232,-1.727),(.045,.305,.055),rear,.016,4)
    for i in range(53):
        b=box('CRT_BottomLouvre_%02d'%i,(-1.65+i*.0635,-1.235,-1.725),(.031,.242,.040),rear,.008,3)
        b.rotation_euler[2]=-.10
    # Side ventilation slots cut actual openings into the sloping rear shell.
    cutters=[]
    for side in [-1,1]:
        for i in range(9):
            y=.385; x=side*(2.005-(y+.40)*.347)
            cut=box('Cutter',(x,y,.25+i*.084),(.32,.84,.034),dark,.016,4)
            cut.rotation_euler[2]=side*math.radians(19.15)
            cutters.append(cut)
        # cavity shadows are set behind the actual slots.
        wall=box('CRT_SideVentInterior_'+str(side),(side*1.60,.385,.58),(.025,.93,.85),dark,.02,3)
        wall.rotation_euler[2]=side*math.radians(19.15)
    bpy.ops.object.select_all(action='DESELECT')
    for c in cutters:c.select_set(True)
    bpy.context.view_layer.objects.active=cutters[0]
    bpy.ops.object.convert(target='MESH'); bpy.ops.object.join()
    cutter=bpy.context.object
    bpy.context.view_layer.objects.active=shell
    boolean=shell.modifiers.new('True side ventilation openings','BOOLEAN');boolean.operation='DIFFERENCE';boolean.object=cutter;boolean.solver='EXACT'
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
    edge=shell.modifiers.new('Vent lip micro bevel','BEVEL'); edge.width=.009; edge.segments=3; edge.limit_method='ANGLE'; edge.angle_limit=.50
    normal=shell.modifiers.new('Moulded panel normals','WEIGHTED_NORMAL'); normal.keep_sharp=True; normal.weight=40
    # Rear ventilation bed, individual ribs, subtly inset connection bay.
    box('CRT_RearVentShadow',(0,1.260,.23),(2.31,.018,1.13),seam,.08,5)
    for i in range(13):
        box('CRT_RearLouvre_%02d'%i,(0,1.282,-.255+i*.081),(2.29,.047,.042),rear,.014,3)
    box('CRT_ConnectionBay',(0,1.263,-.865),(1.60,.028,.39),dark,.05,5)
    box('CRT_PowerSocketRear',(-.49,1.292,-.865),(.34,.07,.24),seam,.034,4)
    for x in [-.57,-.49,-.41]:
        box('CRT_PowerPin',(x,1.336,-.866),(.020,.035,.070),metal,.003,2)
    box('CRT_VGASurround',(.33,1.301,-.866),(.55,.083,.19),metal,.027,4)
    box('CRT_VGASocket',(.33,1.349,-.866),(.36,.023,.118),dark,.024,4)
    for j in range(3):
        for i in range(5):
            cylinder('CRT_VGAContact',(.202+i*.064,1.366,-.826-j*.04),.009,.009,metal,vertices=12)
    for x in [-1.255,1.255]:
        for z in [-1.15,.75]:
            cylinder('CRT_CaseScrew',(x,1.25,z),.032,.028,seam)
            box('CRT_ScrewSlot',(x,1.269,z),(.038,.008,.006),metal,.002,2)

# Consolidate static repeated meshes by semantic group after evaluating bevels.
bpy.context.view_layer.update()
for prefix,joined_name in [('CRT_BottomLouvre_','CRT_BottomLouvres'),('CRT_RearLouvre_','CRT_RearLouvres'),('CRT_PowerPin','CRT_PowerPins'),('CRT_VGAContact','CRT_VGAContacts'),('CRT_CaseScrew','CRT_CaseScrews'),('CRT_ScrewSlot','CRT_ScrewSlots')]:
    obs=[o for o in root.children if o.type=='MESH' and o.name.startswith(prefix)]
    if not obs:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.object.convert(target='MESH');bpy.ops.object.join();bpy.context.object.name=joined_name

def camera(name,loc,target,scale,roll=0):
    d=bpy.data.cameras.new(name); o=bpy.data.objects.new(name,d);scene.collection.objects.link(o)
    o.location=loc; o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    o.rotation_euler.rotate_axis('Z',math.radians(roll));d.type='ORTHO';d.ortho_scale=scale
    return o

beauty=camera('CRT_BeautyCamera',(6,-13,-1.8),(0,-.05,0),6.15,-12)
reference=camera('CRT_ReferenceCamera',(8,-13,-1.8),(0,-.05,0),7.5,-12)
reference.data.shift_x=-.04
scene.camera=beauty
def light(name,loc,power,size,color,target=(0,0,0),size_y=None):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='RECTANGLE';d.size=size;d.size_y=size_y or size;d.color=color
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
light('CRT_KeySoftbox',(-4,-5,7),1050,5,(1,.89,.77),size_y=4)
light('CRT_RightStrip',(5,-2,3),800,2,(.79,.86,1),size_y=6)
light('CRT_RearRim',(1,4,5),1150,4,(1,.93,.80),size_y=3)
light('CRT_ScreenCatchlight',(-1,-6,3),150,4,(1,1,1),size_y=.75)

# Save native source and scoped lossless GLB. Export excludes the authored lighting rig.
HERE.mkdir(parents=True,exist_ok=True)
bpy.context.view_layer.update()
required=['CRT_Root','CRT_Bezel','CRT_RearShell','CRT_Screen']
assert all(n in bpy.data.objects for n in required)
assert screen.data.uv_layers and len(screen.data.vertices)==3185
assert abs(bezel.dimensions.x-4.2)<.001
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'graybox.blend' if GRAY else OUT),compress=True)
if not GRAY and '--skip-export' not in sys.argv:
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in root.children_recursive:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(MASTER),export_format='GLB',use_selection=True,export_apply=True,
        export_animations=False,export_cameras=False,export_lights=False,export_extras=True,
        export_yup=True,export_image_format='AUTO',export_draco_mesh_compression_enable=False)
dg=bpy.context.evaluated_depsgraph_get(); points=[];triangles=0
for o in root.children_recursive:
    if o.type not in ('MESH','FONT'):continue
    eo=o.evaluated_get(dg); me=eo.to_mesh();me.calc_loop_triangles();triangles+=len(me.loop_triangles)
    points.extend(o.matrix_world @ v.co for v in me.vertices);eo.to_mesh_clear()
bounds={'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}
report={'blender':bpy.app.version_string,'triangle_count':triangles,'mesh_objects':len([o for o in root.children_recursive if o.type in ('MESH','FONT')]),'bounds_blender':bounds,'screen_bounds':{'width':sw,'height':sh,'center':[0,-1.145,.14],'center_front_depth':-1.335},'screen_texture':str(TEXTURE) if TEXTURE.exists() else None,'materials':[m.name for m in bpy.data.materials]}
(HERE/('graybox-report.json' if GRAY else 'build-report.json')).write_text(json.dumps(report,indent=2))
if '--render' in sys.argv or '--poster' in sys.argv:
    scene.render.filepath=str(HERE/'graybox.png' if GRAY else POSTER if '--poster' in sys.argv else HERE/'beauty.png')
    if GRAY:scene.render.resolution_percentage=50;scene.cycles.samples=16
    bpy.ops.render.render(write_still=True)
print(json.dumps(report,indent=2))
