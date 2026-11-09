import sys, numpy as np, tflite, onnx
from onnx import helper, numpy_helper, TensorProto
buf=open(sys.argv[1],'rb').read(); m=tflite.Model.GetRootAsModel(buf,0); g=m.Subgraphs(0)
BO=tflite.BuiltinOperator; names={v:k for k,v in BO.__dict__.items() if not k.startswith('_')}
def tensor(i): return g.Tensors(i)
def tname(i): return 't%d'%i
def tdata(i):
    t=tensor(i); b=m.Buffers(t.Buffer()); 
    if b.DataLength()==0: return None
    dt={tflite.TensorType.FLOAT32:np.float32, tflite.TensorType.FLOAT16:np.float16, tflite.TensorType.INT32:np.int32}[t.Type()]
    return np.frombuffer(b.DataAsNumpy().tobytes(),dtype=dt).reshape(t.ShapeAsNumpy() if t.ShapeLength() else ())
consts={}; nodes=[]; inits=[]
def init(name,arr): inits.append(numpy_helper.from_array(np.ascontiguousarray(arr),name)); return name
cnt=[0]
def fresh(p): cnt[0]+=1; return '%s_%d'%(p,cnt[0])
def nchw_const(a):  # NHWC broadcast const -> NCHW
    a=a.astype(np.float32)
    if a.ndim==4: return a.transpose(0,3,1,2)
    if a.ndim==1: return a.reshape(1,-1,1,1)
    return a
def val(i):
    if i in consts: return consts[i]
    return tname(i)
def act(out, fa):
    if fa==tflite.ActivationFunctionType.NONE: return out
    o=fresh('act')
    if fa==tflite.ActivationFunctionType.RELU: nodes.append(helper.make_node('Relu',[out],[o]))
    elif fa==tflite.ActivationFunctionType.RELU6: nodes.append(helper.make_node('Clip',[out,init(fresh('z'),np.float32(0)),init(fresh('s'),np.float32(6))],[o]))
    else: raise Exception('act %d'%fa)
    return o
def same_pads(inH,inW,kH,kW,sH,sW,dH=1,dW=1):
    def p(n,k,s,d):
        out=-(-n//s); tot=max((out-1)*s+(k-1)*d+1-n,0); return tot//2, tot-tot//2
    a,b=p(inH,kH,sH,dH); c,d=p(inW,kW,sW,dW); return [a,c,b,d]
gin=g.Inputs(0); gout=g.Outputs(0)
for i in range(g.OperatorsLength()):
    op=g.Operators(i); oc=m.OperatorCodes(op.OpcodeIndex()); code=max(oc.BuiltinCode(),oc.DeprecatedBuiltinCode())
    ins=list(op.InputsAsNumpy()); outs=list(op.OutputsAsNumpy()); o=tname(outs[0]); nm=names.get(code)
    if nm=='DEQUANTIZE':
        consts[outs[0]]=None; d=tdata(ins[0]).astype(np.float32); consts[outs[0]]=('const',d); continue
    def C(j):
        x=ins[j]
        if x in consts: return consts[x][1]
        d=tdata(x); return None if d is None else d.astype(np.float32)
    def V(j):
        x=ins[j]; c=C(j)
        if c is not None: return init(fresh('c'),nchw_const(c))
        return tname(x)
    if nm in ('CONV_2D','DEPTHWISE_CONV_2D'):
        w=C(1); b=C(2) if len(ins)>2 and ins[2]>=0 else None
        if nm=='CONV_2D':
            o_=tflite.Conv2DOptions(); o_.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            W=w.transpose(0,3,1,2); group=1
        else:
            o_=tflite.DepthwiseConv2DOptions(); o_.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            W=w.transpose(3,0,1,2); group=W.shape[0]
        ish=tensor(ins[0]).ShapeAsNumpy(); kH,kW=W.shape[2],W.shape[3]; sH,sW=o_.StrideH(),o_.StrideW()
        pads=same_pads(ish[1],ish[2],kH,kW,sH,sW) if o_.Padding()==tflite.Padding.SAME else [0,0,0,0]
        args=[V(0),init(fresh('w'),W)]+([init(fresh('b'),b)] if b is not None else [])
        t=fresh('conv'); nodes.append(helper.make_node('Conv',args,[t],strides=[sH,sW],pads=pads,group=group,kernel_shape=[kH,kW]))
        r=act(t,o_.FusedActivationFunction()); nodes.append(helper.make_node('Identity',[r],[o]))
    elif nm in ('ADD','MUL'):
        cls=tflite.AddOptions if nm=='ADD' else tflite.MulOptions; o_=cls(); o_.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
        t=fresh(nm); nodes.append(helper.make_node('Add' if nm=='ADD' else 'Mul',[V(0),V(1)],[t])); r=act(t,o_.FusedActivationFunction()); nodes.append(helper.make_node('Identity',[r],[o]))
    elif nm=='RELU': nodes.append(helper.make_node('Relu',[V(0)],[o]))
    elif nm=='HARD_SWISH': nodes.append(helper.make_node('HardSwish',[V(0)],[o]))
    elif nm=='LOGISTIC': nodes.append(helper.make_node('Sigmoid',[V(0)],[o]))
    elif nm=='MEAN':
        ax=tdata(ins[1]).ravel().tolist(); assert sorted(ax)==[1,2], ax
        nodes.append(helper.make_node('ReduceMean',[V(0),init(fresh('ax'),np.array([2,3],np.int64))],[o],keepdims=1))
    elif nm=='RESIZE_BILINEAR':
        o_=tflite.ResizeBilinearOptions(); o_.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
        size=tdata(ins[1]).ravel(); ish=tensor(ins[0]).ShapeAsNumpy()
        sizes=np.array([ish[0],ish[3],size[0],size[1]],np.int64)
        ct='align_corners' if o_.AlignCorners() else ('half_pixel' if o_.HalfPixelCenters() else 'asymmetric')
        nodes.append(helper.make_node('Resize',[V(0),'','',init(fresh('sz'),sizes)],[o],mode='linear',coordinate_transformation_mode=ct))
    elif code==32 and oc.CustomCode().decode()=='Convolution2DTransposeBias':
        w=C(1); b=C(2); W=w.transpose(3,0,1,2)  # [O,H,W,I] -> [I,O,H,W]
        nodes.append(helper.make_node('ConvTranspose',[V(0),init(fresh('w'),W),init(fresh('b'),b)],[o],strides=[2,2],kernel_shape=[W.shape[2],W.shape[3]]))
    else: raise Exception('unsupported %s'%nm)
ish=tensor(gin).ShapeAsNumpy(); osh=tensor(gout).ShapeAsNumpy()
nodes.insert(0, helper.make_node('Transpose',['input'],[tname(gin)],perm=[0,3,1,2]))
nodes.append(helper.make_node('Transpose',[tname(gout)],['mask'],perm=[0,2,3,1]))
graph=helper.make_graph(nodes,'selfie',[helper.make_tensor_value_info('input',TensorProto.FLOAT,[int(x) for x in ish])],[helper.make_tensor_value_info('mask',TensorProto.FLOAT,[int(x) for x in osh])],inits)
model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',18)]); model.ir_version=8
onnx.checker.check_model(model); onnx.save(model,sys.argv[2]); print('ok',len(nodes))
