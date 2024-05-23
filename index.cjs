/**
The MIT License (MIT)

Copyright (c) 2024 Pawel Misiurski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
**/

const capabilities = ['BLEND', 'CULL_FACE', 'DEPTH_TEST', 'DITHER', 'POLYGON_OFFSET_FILL', 'SAMPLE_ALPHA_TO_COVERAGE', 'SAMPLE_COVERAGE', 'SCISSOR_TEST', 'STENCIL_TEST', 'RASTERIZER_DISCARD']
let featureNameByInt = {}

const DEV_MODE = false
const arr3Eq = (a, p0, p1, p2) => a[0] === p0 && a[1] === p1 && a[2] === p2
const arr4Eq = (a, p0, p1, p2, p3) => a[0] === p0 && a[1] === p1 && a[2] === p2 && a[3] === p3
const set3 = (a, p0, p1, p2) => { a[0] = p0; a[1] = p1; a[2] = p2 }
const set4 = (a, p0, p1, p2, p3) => { a[0] = p0; a[1] = p1; a[2] = p2; a[3] = p3 }

function enhanceWebGLContext(gl) {
  if (gl.stateSyncEnabled) return
  gl.stateSyncEnabled = true

  // checks if gl feature flags changed between same program calls
  const originalDrawArrays = gl.drawArrays
  featureNameByInt = capabilities.reduce((acc, key) => {
    if (Number.isInteger(gl[key])) {
      acc[gl[key]] = key
    }
    return acc
  }, {})

  const { state, sgl } = slowFetchGLState(gl)
  gl.state = state // state with no references that can be serialized
  gl.sgl = sgl // state elements with references that cannot be serialized
  gl.defaultDrawBuffers = Array(gl.getParameter(gl.MAX_DRAW_BUFFERS)).fill(gl.NONE)
  gl.defaultDrawBuffers[0] = gl.COLOR_ATTACHMENT0

  wrapStatefulGLFunctions(gl)
  gl.defaultState = gl.createState()
  gl.savedState = gl.createState()
}

module.exports = {
  enhanceWebGLContext
}

function saveGLFeatures(gl) {
  const capabilities = [
    gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.DITHER, gl.POLYGON_OFFSET_FILL,
    gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE, gl.SCISSOR_TEST, gl.STENCIL_TEST
  ]
  var featuresState = {}
  capabilities.forEach(function(capability) {
    featuresState[capability] = gl.isEnabled(capability)
  })
  return featuresState
}

function restoreGLFeatures(gl, feats, current) {
  Object.keys(feats).forEach(feat => {
    if (feats[feat] === current[feat]) return
    const featureEnum = featureNameByInt[feat]
    const value = feats[feat]
    if (value) gl.enable(feat)
    else gl.disable(feat)
  })
}

function setGLFeaturesPartial(gl, feats, snapshot) {
  Object.keys(feats).forEach(feat => {
    const value = feats[feat]
    if (value === undefined) return
    // const featureEnum = featureNameByInt[feat]
    if (value) gl.enable(feat)
    else gl.disable(feat)
  })
}

function saveStorei(gl) {
  const pixelStoreiEnums = [
    gl.PACK_ALIGNMENT, gl.UNPACK_ALIGNMENT, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
    gl.UNPACK_ROW_LENGTH, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_PIXELS, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS // WebGL 2 enums
  ]
  var storei = {}
  pixelStoreiEnums.forEach(function(feature) {
    storei[feature] = gl.getParameter(feature)
  })
  return storei
}

function restoreStorei(gl, storei, current) {
  Object.keys(storei).forEach(feat => {
    if (storei[feat] === current[feat]) return
    gl.pixelStorei(feat, storei[feat])
  })
}

function wrapStatefulGLFunctions(gl) {
  let id = 0
  const originalUseProgram = gl.useProgram
  const history = []
  let recording = false

  gl.useProgram = function useProgram(program) {
    if (gl.sgl.activeProgram === program) return
    gl.sgl.activeProgram = program
    DEV_MODE && recording && history.push(['useProgram'])
    return originalUseProgram.call(gl, program)
  }

  const originalBindTexture = gl.bindTexture
  gl.bindTexture = function bindTexture(type, texture) {
    const currentActive = gl.state.activeTexture - gl.TEXTURE0
    if (DEV_MODE && currentActive < 0) throw new Error('gl.state.activeTexture is less than gl.TEXTURE0')
    if (!texture) gl.sgl.textures[currentActive] = null
    else gl.sgl.textures[currentActive] = [type, texture]
    DEV_MODE && recording && history.push(['bindTexture', type, texture])
    return originalBindTexture.call(gl, type, texture)
  }

  // example function holding state
  gl.state.activeTexture = gl.TEXTURE0 // default is slot 0
  const originalActiveTexture = gl.activeTexture
  gl.activeTexture = function activeTexture(slot) {
    if (DEV_MODE && slot < gl.TEXTURE0) throw new Error('activeTexture: slot must be at least gl.TEXTURE0)')
    if (gl.state.activeTexture === slot) return
    gl.state.activeTexture = slot
    DEV_MODE && recording && history.push(['activeTexture', slot - gl.TEXTURE0])
    return originalActiveTexture.call(gl, slot)
  }

  const originalViewport = gl.viewport
  gl.viewport = function viewport(x, y, width, height) {
    if (arr4Eq(gl.state.viewport, x, y, width, height)) return
    set4(gl.state.viewport, x, y, width, height)
    DEV_MODE && recording && history.push(['viewport', x, y, width, height])
    originalViewport.call(gl, x, y, width, height)
  }

  const originalBlendColor = gl.blendColor
  gl.blendColor = function blendColor(red, green, blue, alpha) {
    if (arr4Eq(gl.state.blendColor, red, green, blue, alpha)) return
    set4(gl.state.blendColor, red, green, blue, alpha)
    DEV_MODE && recording && history.push(['blendColor', red, green, blue, alpha])
    originalBlendColor.call(gl, red, green, blue, alpha)
  }

  const originalBlendEquation = gl.blendEquation
  gl.blendEquation = function blendEquation(mode) {
    if (gl.state.blendEquationRgb === mode && gl.state.blendEquationAlpha === mode) return
    gl.state.blendEquationRgb = mode
    gl.state.blendEquationAlpha = mode
    DEV_MODE && recording && history.push(['blendEquation', mode])
    originalBlendEquation.call(gl, mode)
  }

  const originalBlendEquationSeparate = gl.blendEquationSeparate
  gl.blendEquationSeparate = function blendEquationSeparate(modeRGB, modeAlpha) {
    if (gl.state.blendEquationRgb === modeRGB && gl.state.blendEquationAlpha === modeAlpha) return
    gl.state.blendEquationRgb = modeRGB
    gl.state.blendEquationAlpha = modeAlpha
    originalBlendEquationSeparate.call(gl, modeRGB, modeAlpha)
  }

  const originalBlendFunc = gl.blendFunc
  gl.blendFunc = function blendFunc(sBoth, dBoth) {
    if (arr4Eq(gl.state.blendFuncSeparate, sBoth, dBoth, sBoth, dBoth)) return
    set4(gl.state.blendFuncSeparate, sBoth, dBoth, sBoth, dBoth)
    DEV_MODE && recording && history.push(['blendFunc', sBoth, dBoth, sBoth, dBoth])
    originalBlendFunc.call(gl, sBoth, dBoth)
  }

  const originalBlendFuncSeparate = gl.blendFuncSeparate
  gl.blendFuncSeparate = function blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha) {
    if (arr4Eq(gl.state.blendFuncSeparate, srcRGB, dstRGB, srcAlpha, dstAlpha)) return
    set4(gl.state.blendFuncSeparate, srcRGB, dstRGB, srcAlpha, dstAlpha)
    DEV_MODE && recording && history.push(['blendFuncSeparate', srcRGB, dstRGB, srcAlpha, dstAlpha])
    return originalBlendFuncSeparate.call(gl, srcRGB, dstRGB, srcAlpha, dstAlpha)
  }

  const originalCullFace = gl.cullFace
  gl.cullFace = function cullFace(mode) {
    if (DEV_MODE && mode < 0) throw new Error('cullFace: mode must be a valid face culling mode')
    if (gl.state.cullFaceMode === mode) return
    gl.state.cullFaceMode = mode
    DEV_MODE && recording && history.push(['cullFace', mode])
    return originalCullFace.call(gl, mode)
  }

  const originalFrontFace = gl.frontFace
  gl.frontFace = function frontFace(face) {
    if (DEV_MODE && face < 0) throw new Error('frontFace: face must be a valid winding order')
    if (gl.state.frontFace === face) return
    gl.state.frontFace = face
    DEV_MODE && recording && history.push(['frontFace', face])
    return originalFrontFace.call(gl, face)
  }

  const originalLineWidth = gl.lineWidth
  gl.lineWidth = function lineWidth(width) {
    if (DEV_MODE && width <= 0) throw new Error('lineWidth: width must be greater than 0')
    if (gl.state.lineWidth === width) return
    gl.state.lineWidth = width
    DEV_MODE && recording && history.push(['lineWidth', width])
    return originalLineWidth.call(gl, width)
  }

  const originalClearColor = gl.clearColor
  gl.clearColor = function clearColor(red, green, blue, alpha) {
    if (arr4Eq(gl.state.clearColor, red, green, blue, alpha)) return
    set4(gl.state.clearColor, red, green, blue, alpha)
    DEV_MODE && recording && history.push(['clearColor', red, green, blue, alpha])
    return originalClearColor.call(gl, red, green, blue, alpha)
  }

  const originalColorMask = gl.colorMask
  gl.colorMask = function colorMask(red, green, blue, alpha) {
    if (arr4Eq(gl.state.colorMask, red, green, blue, alpha)) return
    set4(gl.state.colorMask, red, green, blue, alpha)
    DEV_MODE && recording && history.push(['colorMask', red, green, blue, alpha])
    return originalColorMask.call(gl, red, green, blue, alpha)
  }

  const originalClearDepth = gl.clearDepth
  gl.clearDepth = function clearDepth(depthValue) {
    if (gl.state.clearDepth === depthValue) return
    gl.state.clearDepth = depthValue
    DEV_MODE && recording && history.push(['clearDepth', depthValue])
    return originalClearDepth.call(gl, depthValue)
  }

  const originalDepthFunc = gl.depthFunc
  gl.depthFunc = function depthFunc(func) {
    if (DEV_MODE && func < 0) throw new Error('depthFunc: func must be a valid depth function')
    if (gl.state.depthFunc === func) return
    gl.state.depthFunc = func
    DEV_MODE && recording && history.push(['depthFunc', func])
    return originalDepthFunc.call(gl, func)
  }

  const originalDepthMask = gl.depthMask
  gl.depthMask = function depthMask(flag) {
    if (gl.state.depthMask === flag) return
    gl.state.depthMask = flag
    DEV_MODE && recording && history.push(['depthMask', flag])
    return originalDepthMask.call(gl, flag)
  }

  const originalDepthRange = gl.depthRange
  gl.depthRange = function depthRange(near, far) {
    if (gl.state.depthRange[0] === near && gl.state.depthRange[1] === far) return
    gl.state.depthRange = [near, far]
    DEV_MODE && recording && history.push(['depthRange', near, far])
    return originalDepthRange.call(gl, near, far)
  }

  const originalPolygonOffset = gl.polygonOffset
  gl.polygonOffset = function polygonOffset(factor, units) {
    if (gl.state.polygonOffset[0] === factor && gl.state.polygonOffset[1] === units) return
    gl.state.polygonOffset = [factor, units]
    DEV_MODE && recording && history.push(['polygonOffset', factor, units])
    return originalPolygonOffset.call(gl, factor, units)
  }

  const originalSampleCoverage = gl.sampleCoverage
  gl.sampleCoverage = function sampleCoverage(value, invert) {
    if (gl.state.sampleCoverage[0] === value && gl.state.sampleCoverage[1] === invert) return
    gl.state.sampleCoverage = [value, invert]
    DEV_MODE && recording && history.push(['sampleCoverage', value, invert])
    return originalSampleCoverage.call(gl, value, invert)
  }

  const originalScissor = gl.scissor
  gl.scissor = function scissor(x, y, width, height) {
    if (arr4Eq(gl.state.scissor, x, y, width, height)) return
    set4(gl.state.scissor, x, y, width, height)
    DEV_MODE && recording && history.push(['scissor', x, y, width, height])
    return originalScissor.call(gl, x, y, width, height)
  }

  const originalStencilFunc = gl.stencilFunc
  gl.stencilFunc = function stencilFunc(func, ref, mask) {
    if (arr3Eq(gl.state.stencilFunc, func, ref, mask) && arr3Eq(gl.state.stencilBackFunc, func, ref, mask)) return
    set3(gl.state.stencilFunc, func, ref, mask)
    set3(gl.state.stencilBackFunc, func, ref, mask)
    DEV_MODE && recording && history.push(['stencilFunc', func, ref, mask])
    return originalStencilFunc.call(gl, func, ref, mask)
  }

  const originalStencilOp = gl.stencilOp
  gl.stencilOp = function stencilOp(fail, zfail, zpass) {
    if (arr3Eq(gl.state.stencilOp, fail, zfail, zpass) && arr3Eq(gl.state.stencilBackOp, fail, zfail, zpass)) return
    set3(gl.state.stencilOp, fail, zfail, zpass)
    set3(gl.state.stencilBackOp, fail, zfail, zpass)
    DEV_MODE && recording && history.push(['stencilOp', fail, zfail, zpass])
    return originalStencilOp.call(gl, fail, zfail, zpass)
  }

  const originalStencilMask = gl.stencilMask
  gl.stencilMask = function stencilMask(mask) {
    if (gl.state.stencilMask === mask && gl.state.stencilBackMask === mask) return
    gl.state.stencilMask = mask
    gl.state.stencilBackMask = mask
    DEV_MODE && recording && history.push(['stencilMask', mask])
    return originalStencilMask.call(gl, mask)
  }

  const originalclearStencil = gl.clearStencil
  gl.clearStencil = function clearStencil(s) {
    if (gl.state.clearStencil === s) return
    gl.state.clearStencil = s
    DEV_MODE && recording && history.push(['clearStencil', s])
    return originalclearStencil.call(gl, s)
  }

  const originalStencilFuncSeparate = gl.stencilFuncSeparate
  gl.stencilFuncSeparate = function stencilFuncSeparate(face, func, ref, mask) {
    const setFront = face === gl.FRONT || face === gl.FRONT_AND_BACK
    const setBack = face === gl.BACK || face === gl.FRONT_AND_BACK
    let needsUpdate = false
    if (setFront && !arr3Eq(gl.state.stencilFunc, func, ref, mask)) {
      set3(gl.state.stencilFunc, func, ref, mask)
      needsUpdate = true
    }
    if (setBack && !arr3Eq(gl.state.stencilBackFunc, func, ref, mask)) {
      set3(gl.state.stencilBackFunc, func, ref, mask)
      needsUpdate = true
    }
    if (!needsUpdate) return
    DEV_MODE && recording && history.push(['stencilFuncSeparate', func, ref, mask])
    return originalStencilFuncSeparate.call(gl, face, func, ref, mask)
  }

  const originalStencilOpSeparate = gl.stencilOpSeparate
  gl.stencilOpSeparate = function stencilOpSeparate(face, fail, zfail, zpass) {
    const setFront = face === gl.FRONT || face === gl.FRONT_AND_BACK
    const setBack = face === gl.BACK || face === gl.FRONT_AND_BACK
    let needsUpdate = false
    if (setFront && !arr3Eq(gl.state.stencilOp, fail, zfail, zpass)) {
      set3(gl.state.stencilOp, fail, zfail, zpass)
      needsUpdate = true
    }
    if (setBack && !arr3Eq(gl.state.stencilBackOp, fail, zfail, zpass)) {
      set3(gl.state.stencilBackOp, fail, zfail, zpass)
      needsUpdate = true
    }
    if (!needsUpdate) return
    DEV_MODE && recording && history.push(['stencilOpSeparate', fail, zfail, zpass])
    return originalStencilOpSeparate.call(gl, face, fail, zfail, zpass)
  }

  const originalStencilMaskSeparate = gl.stencilMaskSeparate
  gl.stencilMaskSeparate = function stencilMaskSeparate(face, mask) {
    let changed = false
    if ((face === gl.FRONT || face === gl.FRONT_AND_BACK) && gl.state.stencilMask !== mask) {
      gl.state.stencilMask = mask
      changed = true
    }
    if ((face === gl.BACK || face === gl.FRONT_AND_BACK) && gl.state.stencilBackMask !== mask) {
      gl.state.stencilBackMask = mask
      changed = true
    }
    if (!changed) return
    DEV_MODE && recording && history.push(['stencilMaskSeparate', face, mask])
    return originalStencilMaskSeparate.call(gl, face, mask)
  }

  const originalDrawBuffers = gl.drawBuffers
  gl.drawBuffers = function drawBuffers(buffers) {
    gl.lastDrawBufferBound.currentDrawBuffers = buffers.slice()
    const result = originalDrawBuffers.call(gl, buffers)
    // checkFramebufferDrawBuffers(gl, gl.lastDrawBufferBound)
    // checkFramebufferDrawBuffers2(gl, gl.lastDrawBufferBound, buffers)
    DEV_MODE && recording && history.push(['drawBuffers', buffers])
    return result
  }

  const originalReadBuffer = gl.readBuffer
  gl.readBuffer = function readBuffer(buffer) {
    gl.lastReadBufferBound.currentReadBuffer = buffer
    const result = originalReadBuffer.call(gl, buffer)
    // checkFramebufferReadBuffer(gl, gl.lastReadBufferBound)
    DEV_MODE && recording && history.push(['readBuffer', buffer])
    return result
  }

  const originalBindFramebuffer = gl.bindFramebuffer
  gl.bindFramebuffer = function bindFramebuffer(fbType, fb) {
    if (fbType === gl.FRAMEBUFFER) {
      gl.sgl.boundFramebuffer = fb
      gl.sgl.boundDrawingBuffer = fb
      gl.sgl.boundReadingBuffer = fb
      gl.lastReadBufferBound = fb
      gl.lastDrawBufferBound = fb
    } else if (fbType === gl.DRAW_FRAMEBUFFER) {
      gl.sgl.boundDrawingBuffer = fb
      gl.lastDrawBufferBound = fb
    } else if (fbType === gl.READ_FRAMEBUFFER) {
      gl.sgl.boundReadingBuffer = fb
      gl.lastReadBufferBound = fb
    }
    if (fb && fb.id === undefined) fb.id = id++

    const result = originalBindFramebuffer.call(gl, fbType, fb)
    // if (fb) checkFramebufferDrawAndReadBuffers(fbType, fb)
    DEV_MODE && recording && history.push(['bindFramebuffer', fbType, fb])
    return result
  }

  // Note: Not tracking renderbuffer anymore. Ususally it's explicitly set just before performing configuration changes and not before each render target change like with framebuffer
  // const originalBindRenderbuffer = gl.bindRenderbuffer
  // gl.bindRenderbuffer = function bindRenderbuffer(fbType, fb) {
  //   gl.sgl.boundRenderbuffer = fb
  //   if (fb && fb.id === undefined) fb.id = id++
  //   DEV_MODE && recording && history.push(['bindRenderbuffer', fbType, fb])
  //   return originalBindRenderbuffer.call(gl, fbType, fb)
  // }

  // gl.sgl.boundBufferTarget = null
  // gl.sgl.boundBuffer = null
  // gl.sgl.boundRenderbuffer = null
  gl.sgl.boundFramebuffer = null
  gl.sgl.boundReadingBuffer = null
  gl.sgl.boundDrawingBuffer = null

  const originalBindVertexArray = gl.bindVertexArray
  gl.bindVertexArray = function bindVertexArray(vao) {
    if (gl.sgl.vertexArrayBinding === vao) return
    gl.sgl.vertexArrayBinding = vao
    DEV_MODE && recording && history.push(['bindVertexArray', vao])
    originalBindVertexArray.call(gl, vao)
  }

  const originalBindBuffer = gl.bindBuffer
  gl.bindBuffer = function bindBuffer(target, buffer) {
    if (gl.sgl.boundBufferTarget === target && gl.sgl.boundBuffer === buffer) return

    if (target === gl.ARRAY_BUFFER) {
      gl.sgl.arrayBufferBinding = buffer
    } else if (target === gl.ELEMENT_ARRAY_BUFFER) {
      gl.sgl.elementArrayBufferBinding = buffer
    } else if (target === gl.UNIFORM_BUFFER) {
      gl.sgl.uniformBufferBinding = buffer
    }
    gl.sgl.boundBufferTarget = target
    gl.sgl.boundBuffer = buffer
    DEV_MODE && recording && history.push(['bindBuffer', target, buffer])
    return originalBindBuffer.call(gl, target, buffer)
  }

  const originalPixelStorei = gl.pixelStorei
  gl.pixelStorei = function pixelStorei(feat, value) {
    if (gl.state.storei[feat] === value) return
    gl.state.storei[feat] = value
    DEV_MODE && recording && history.push(['pixelStorei', feat, value])
    originalPixelStorei.call(gl, feat, value)
  }

  const originalEnable = gl.enable
  gl.enable = function enable(feature) {
    if (gl.state.feats[feature] === true) return
    gl.state.feats[feature] = true
    DEV_MODE && recording && history.push(['enable', feature])
    return originalEnable.call(gl, feature)
  }
  const originalDisable = gl.disable
  gl.disable = function disable(feature) {
    if (gl.state.feats[feature] === false) return
    gl.state.feats[feature] = false
    DEV_MODE && recording && history.push(['disable', feature])
    return originalDisable.call(gl, feature)
  }

  // Debug use only
  gl.record = function record() {
    history.length = 0
    recording = true
  }
  // Debug use only
  gl.stopRecording = function record() {
    recording = false
    console.log(history.slice())
  }

  gl.copyState = function copyState(target, source) {
    source = source || gl
    copySnapshot(target, source)
  }

  // Note: Never save and then restore after an asynchronous break (i.e. in a promise or a callback, or after await). During that break Three or Babylon will assign and internally cache some webgl state. Now after restore they will hold incorrect cached state and won't set it in webgl correctly
  let warned = false
  gl.saveState = function saveState(target) {
    copySnapshot(target ? target : gl.savedState, gl)
  }

  // Creates a new state container that should be passed to saveState and restoreState
  gl.createState = function createState() {
    const snapshot = {}
    const state = JSON.parse(JSON.stringify(gl.state))

    const sgl = {}
    // Gl objects that won't come out stringified well
    sgl.arrayBufferBinding = gl.sgl.arrayBufferBinding // gl.getParameter(gl.ARRAY_BUFFER_BINDING)
    sgl.elementArrayBufferBinding = gl.sgl.elementArrayBufferBinding // gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)
    sgl.uniformBufferBinding = gl.sgl.uniformBufferBinding
    sgl.vertexArrayBinding = gl.sgl.vertexArrayBinding // gl.getParameter(gl.VERTEX_ARRAY_BINDING)

    sgl.activeProgram = gl.sgl.activeProgram
    // sgl.renderbuffer = packFramebuffer(gl, gl.sgl.boundRenderbuffer, gl.RENDERBUFFER)
    sgl.framebuffer = packFramebuffer(gl, gl.sgl.boundFramebuffer, gl.FRAMEBUFFER)
    sgl.readingBuffer = packFramebuffer(gl, gl.sgl.boundReadingBuffer, gl.READ_FRAMEBUFFER)
    sgl.drawingBuffer = packFramebuffer(gl, gl.sgl.boundDrawingBuffer, gl.DRAW_FRAMEBUFFER)

    sgl.lastDrawBufferBound = gl.lastDrawBufferBound
    sgl.lastReadBufferBound = gl.lastReadBufferBound

    sgl.textures = gl.sgl.textures.slice()
    return { state, sgl: sgl }
  }

  function cpArr(t, s, l) {
    for (let i = 0; i < l; ++i) {
      t[i] = s[i]
    }
  }

  function copySnapshot(target, source) {
    Object.assign(target.state.feats, source.state.feats)
    Object.assign(target.state.storei, source.state.storei)
    // for (var feat in source.state.feats) target.state.feats[feat] = source.state.feats[feat]
    // for (var prop in source.state.storei) target.state.storei[prop] = source.state.storei[prop]
    target.state.activeTexture = source.state.activeTexture
    cpArr(target.state.viewport, source.state.viewport, 4)
    cpArr(target.state.blendColor, source.state.blendColor, 4)
    target.state.blendEquationRgb = source.state.blendEquationRgb
    target.state.blendEquationAlpha = source.state.blendEquationAlpha
    target.state.cullFaceMode = source.state.cullFaceMode
    target.state.depthFunc = source.state.depthFunc
    target.state.frontFace = source.state.frontFace
    target.state.lineWidth = source.state.lineWidth
    cpArr(target.state.blendFuncSeparate, source.state.blendFuncSeparate, 4)
    cpArr(target.state.clearColor, source.state.clearColor, 4)
    cpArr(target.state.colorMask, source.state.colorMask, 4)
    target.state.clearDepth = source.state.clearDepth
    target.state.depthMask = source.state.depthMask
    cpArr(target.state.depthRange, source.state.depthRange, 2)
    cpArr(target.state.polygonOffset, source.state.polygonOffset, 2)
    cpArr(target.state.sampleCoverage, source.state.sampleCoverage, 2)
    cpArr(target.state.scissor, source.state.scissor, 4)
    cpArr(target.state.stencilFunc, source.state.stencilFunc, 3)
    cpArr(target.state.stencilOp, source.state.stencilOp, 3)
    target.state.stencilMask = source.state.stencilMask
    target.state.clearStencil = source.state.clearStencil
    cpArr(target.state.stencilBackFunc, source.state.stencilBackFunc, 3)
    cpArr(target.state.stencilBackOp, source.state.stencilBackOp, 3)
    target.state.stencilBackMask = source.state.stencilBackMask
    target.sgl.activeProgram = source.sgl.activeProgram
    target.sgl.arrayBufferBinding = source.sgl.arrayBufferBinding
    target.sgl.elementArrayBufferBinding = source.sgl.elementArrayBufferBinding
    target.sgl.uniformBufferBinding = source.sgl.uniformBufferBinding
    target.sgl.vertexArrayBinding = source.sgl.vertexArrayBinding
    target.sgl.lastReadBufferBound = source.sgl.lastReadBufferBound
    target.sgl.lastDrawBufferBound = source.sgl.lastDrawBufferBound

    // packFramebufferInto(gl, target.sgl.renderbuffer, gl.sgl.boundRenderbuffer, gl.RENDERBUFFER)
    packFramebufferInto(gl, target.sgl.framebuffer, gl.sgl.boundFramebuffer, gl.FRAMEBUFFER)
    packFramebufferInto(gl, target.sgl.readingBuffer, gl.sgl.boundReadingBuffer, gl.READ_FRAMEBUFFER)
    packFramebufferInto(gl, target.sgl.drawingBuffer, gl.sgl.boundDrawingBuffer, gl.DRAW_FRAMEBUFFER)

    for (let i = 0, il = gl.sgl.textures.length; i < il; i++) {
      target.sgl.textures[i] = gl.sgl.textures[i]
    }
  }

  gl.restoreState = function restoreState(snapshot) {
    setGLState(gl, snapshot ? snapshot : gl.savedState)
  }

  gl.setState = function setState(snapshot) {
    setGLStatePartial(gl, snapshot)
  }

  gl.resetToDefaults = function resetToDefaults() {
    resetToDefaults(gl)
  }

  gl.showCurrentState = function showCurrentState() {
    // TODO: Implement a diff to show all changed params
  }

  gl.defaultPixelStore = function defaultPixelStore() {
    // restoreStorei(gl, gl.defaultState.state.storei, gl.state.storei) // reset of all pixelStorei settings - most likely not needed
    if (gl.state.storei[gl.UNPACK_FLIP_Y_WEBGL]) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    if (gl.state.storei[gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL]) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    if (gl.state.storei[gl.UNPACK_COLORSPACE_CONVERSION_WEBGL] !== gl.BROWSER_DEFAULT_WEBGL) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL)
    if (gl.state.storei[gl.UNPACK_ALIGNMENT] !== 4) gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    if (gl.state.storei[gl.PACK_ALIGNMENT] !== 4) gl.pixelStorei(gl.PACK_ALIGNMENT, 4)
  }

  // TODO: add a custom setup that will be set here i.e. gl.customSetup = { feats: { BLEND: true, DEPTH_TEST: true } }
  gl.slowFetchState = function slowFetchState() {
    return slowFetchGLState(gl)
  }

  // gl.boundBufferBase = null
  // const originalBindBufferBase = gl.bindBufferBase
  // gl.bindBufferBase = function bindBufferBase(target, buffer, index) {
  //   if (gl.state.boundBufferBase[0] === target && gl.state.boundBufferBase[1] === buffer && gl.state.boundBufferBase[2] === index) return
  //   gl.state.boundBufferBase = [target, buffer, index]
  //   return originalBindBufferBase.call(gl, target, buffer, index)
  // }

  // const originalBindBufferRange = gl.bindBufferRange
  // gl.bindBufferRange = function bindBufferRange(target, index, buffer, offset, size) {
    // const s = gl.state.boundBufferRange
    // if (s[0] === target && s[1] === index && s[2] === buffer && s[3] === offset && s[4] === size) return
    //   gl.state.boundBufferRange = [target, index, buffer, offset, size]
  //   return originalBindBufferRange.call(gl, target, index, buffer, offset, size)
  // }
}

function resetWebGLCapabilities(gl) {
  gl.disable(gl.BLEND)
  gl.disable(gl.CULL_FACE)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.DITHER)
  gl.disable(gl.POLYGON_OFFSET_FILL)
  gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)
  gl.disable(gl.SAMPLE_COVERAGE)
  gl.disable(gl.SCISSOR_TEST)
  gl.disable(gl.STENCIL_TEST)
  gl.disable(gl.RASTERIZER_DISCARD)
}

function resetToDefaults(gl) {
  resetWebGLCapabilities(gl)
  // gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  gl.bindVertexArray(null)
  // gl.bindBuffer(gl.ARRAY_BUFFER, null)

  // gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
  gl.blendColor(0, 0, 0, 0)
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD)
  gl.cullFace(gl.BACK)
  gl.depthFunc(gl.LESS)
  gl.frontFace(gl.CCW)
  gl.lineWidth(1)
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 1)
  gl.colorMask(true, true, true, true)
  gl.clearDepth(1)
  gl.depthMask(true)
  gl.depthRange(0, 1)
  gl.polygonOffset(0, 0)
  gl.sampleCoverage(1, false)
  // gl.scissor(0, 0, gl.canvas.width, gl.canvas.height)
  gl.stencilFunc(gl.ALWAYS, 1, 0xFF)
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
  gl.stencilMask(0xFF)
  gl.clearStencil(0)
  gl.stencilFuncSeparate(gl.BACK, gl.ALWAYS, 1, 0xFF)
  gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.KEEP)
  gl.stencilMaskSeparate(gl.BACK, 0xFF)
}

// This should ONLY be used once at the start or for debugging
function slowFetchGLState(gl) {
  const state = {}

  state.feats = saveGLFeatures(gl)
  state.storei = saveStorei(gl)
  state.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) || gl.TEXTURE0
  const viewport = gl.getParameter(gl.VIEWPORT)
  state.viewport = [viewport[0], viewport[1], viewport[2], viewport[3]]
  state.blendColor = gl.getParameter(gl.BLEND_COLOR)
  state.blendEquationRgb = gl.getParameter(gl.BLEND_EQUATION_RGB)
  state.blendEquationAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA)
  state.cullFaceMode = gl.getParameter(gl.CULL_FACE_MODE)
  state.depthFunc = gl.getParameter(gl.DEPTH_FUNC)
  state.frontFace = gl.getParameter(gl.FRONT_FACE)
  state.lineWidth = gl.getParameter(gl.LINE_WIDTH)
  state.blendFuncSeparate = [
    gl.getParameter(gl.BLEND_SRC_RGB),
    gl.getParameter(gl.BLEND_DST_RGB),
    gl.getParameter(gl.BLEND_SRC_ALPHA),
    gl.getParameter(gl.BLEND_DST_ALPHA)
  ]
  state.clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE)
  state.colorMask = gl.getParameter(gl.COLOR_WRITEMASK)
  state.clearDepth = gl.getParameter(gl.DEPTH_CLEAR_VALUE)
  state.depthMask = gl.getParameter(gl.DEPTH_WRITEMASK)
  state.depthRange = gl.getParameter(gl.DEPTH_RANGE)
  state.polygonOffset = [
    gl.getParameter(gl.POLYGON_OFFSET_FACTOR),
    gl.getParameter(gl.POLYGON_OFFSET_UNITS)
  ]
  state.sampleCoverage = [
    gl.getParameter(gl.SAMPLE_COVERAGE_VALUE),
    gl.getParameter(gl.SAMPLE_COVERAGE_INVERT)
  ]
  state.scissor = gl.getParameter(gl.SCISSOR_BOX)
  state.stencilFunc = [
    gl.getParameter(gl.STENCIL_FUNC),
    gl.getParameter(gl.STENCIL_REF),
    gl.getParameter(gl.STENCIL_VALUE_MASK)
  ]
  state.stencilOp = [
    gl.getParameter(gl.STENCIL_FAIL),
    gl.getParameter(gl.STENCIL_PASS_DEPTH_FAIL),
    gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS)
  ]
  state.stencilMask = gl.getParameter(gl.STENCIL_WRITEMASK)
  if (state.stencilMask === 0x7FFFFFFF) {
    // Addressing a bug in Chrome https://github.com/mrdoob/three.js/issues/28252
    state.stencilMask = 0xFFFFFFFF
  }

  state.clearStencil = gl.getParameter(gl.STENCIL_CLEAR_VALUE)

  state.stencilBackFunc = [
    gl.getParameter(gl.STENCIL_BACK_FUNC),
    gl.getParameter(gl.STENCIL_BACK_REF),
    gl.getParameter(gl.STENCIL_BACK_VALUE_MASK),
  ]
  state.stencilBackOp = [
    gl.getParameter(gl.STENCIL_BACK_FAIL),
    gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_FAIL),
    gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_PASS),
  ]
  state.stencilBackMask = gl.getParameter(gl.STENCIL_BACK_WRITEMASK)
  if (state.stencilBackMask === 0x7FFFFFFF) state.stencilBackMask = 0xFFFFFFFF

  const sgl = {}
  sgl.activeProgram = gl.getParameter(gl.CURRENT_PROGRAM)
  sgl.arrayBufferBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING)
  sgl.elementArrayBufferBinding = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)
  sgl.uniformBufferBinding = gl.getParameter(gl.UNIFORM_BUFFER_BINDING)

  sgl.vertexArrayBinding = gl.getParameter(gl.VERTEX_ARRAY_BINDING)

  // sgl.renderbuffer = glPackFramebuffer(gl, gl.getParameter(gl.RENDERBUFFER_BINDING), gl.RENDERBUFFER)
  sgl.framebuffer = glPackFramebuffer(gl, gl.getParameter(gl.FRAMEBUFFER_BINDING), gl.FRAMEBUFFER)
  sgl.readingBuffer = glPackFramebuffer(gl, gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), gl.READ_FRAMEBUFFER)
  sgl.drawingBuffer = glPackFramebuffer(gl, gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), gl.DRAW_FRAMEBUFFER)

  // when reading from state we assume that bound gl.FRAMEBUFFER is accessible under gl.DRAW_FRAMEBUFFER_BINDING
  sgl.lastReadBufferBound = sgl.readingBuffer.buffer
  sgl.lastDrawBufferBound = sgl.drawingBuffer.buffer

  sgl.textures = getBoundTextures(gl, state.activeTexture)
  return { state, sgl }
}

function glPackFramebuffer(gl, pxbuffer, type) { // pxbuffer can be either framebuffer, draw or read
  const buf = { buffer: pxbuffer }
  // if (type === gl.RENDERBUFFER) return buf

  if (pxbuffer !== null) {
    gl.bindFramebuffer(type, pxbuffer)
    if (type === gl.FRAMEBUFFER || type === gl.READ_FRAMEBUFFER) {
      buf.readBuffer = gl.getParameter(gl.READ_BUFFER)
    }
    if (type === gl.FRAMEBUFFER || type === gl.DRAW_FRAMEBUFFER) {
      const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS)
      buf.drawBuffers = []
      for (let i = 0; i < maxDrawBuffers; i++) {
        buf.drawBuffers.push(gl.getParameter(gl.DRAW_BUFFER0 + i))
      }
    }
  }
  return buf
}

function packFramebuffer(gl, pxbuffer, type) { // pxbuffer can be either framebuffer, draw, or read
  const buf = { buffer: pxbuffer }
  if (pxbuffer !== null) {
    if (type === gl.FRAMEBUFFER || type === gl.READ_FRAMEBUFFER) {
      buf.readBuffer = pxbuffer.currentReadBuffer || gl.COLOR_ATTACHMENT0
      // Debug stuff
      // // bind and test
      // gl.bindFramebuffer(type, pxbuffer)
      // if (gl.getParameter(gl.READ_BUFFER) !== buf.readBuffer) debugger
      // gl.readBuffer(buf.readBuffer) // part of test to restore internal state after binding
    }
    if (type === gl.FRAMEBUFFER || type === gl.DRAW_FRAMEBUFFER) {
      if (pxbuffer.currentDrawBuffers) {
        buf.drawBuffers = pxbuffer.currentDrawBuffers.slice()
      } else {
        buf.drawBuffers = gl.defaultDrawBuffers
      }
      // Debug stuff
      // bind the framebuffer and read its drawBuffers for comparison
      // gl.bindFramebuffer(type, pxbuffer)
      // const drawBuffers = []
      // for (let i = 0, il = gl.getParameter(gl.MAX_DRAW_BUFFERS); i < il; i++) drawBuffers.push(gl.getParameter(gl.DRAW_BUFFER0 + i))
      // if (JSON.stringify(buf.drawBuffers) !== JSON.stringify(drawBuffers)) debugger
      // gl.drawBuffers(buf.drawBuffers) // part of test to restore internal state after binding
    }
  }
  return buf
}

function packFramebufferInto(gl, target, pxbuffer, type) { // pxbuffer can be either framebuffer, draw, or read
  target.buffer = pxbuffer
  const buf = target
  buf.readBuffer = undefined
  buf.drawBuffers = undefined
  if (pxbuffer !== null) {
    if (type === gl.FRAMEBUFFER || type === gl.READ_FRAMEBUFFER) {
      buf.readBuffer = pxbuffer.currentReadBuffer || gl.COLOR_ATTACHMENT0
      // Debug stuff
      // // bind and test
      // gl.bindFramebuffer(type, pxbuffer)
      // if (gl.getParameter(gl.READ_BUFFER) !== buf.readBuffer) debugger
      // gl.readBuffer(buf.readBuffer) // part of test to restore internal state after binding
    }
    if (type === gl.FRAMEBUFFER || type === gl.DRAW_FRAMEBUFFER) {
      if (pxbuffer.currentDrawBuffers) {
        // TODO: Get rid of this slice and copy by values
        buf.drawBuffers = pxbuffer.currentDrawBuffers.slice()
      } else {
        // TODO: verify risk of overwriting gl.defaultDrawBuffers ?
        buf.drawBuffers = gl.defaultDrawBuffers
      }
      // Debug stuff
      // bind the framebuffer and read its drawBuffers for comparison
      // gl.bindFramebuffer(type, pxbuffer)
      // const drawBuffers = []
      // for (let i = 0, il = gl.getParameter(gl.MAX_DRAW_BUFFERS); i < il; i++) drawBuffers.push(gl.getParameter(gl.DRAW_BUFFER0 + i))
      // if (JSON.stringify(buf.drawBuffers) !== JSON.stringify(drawBuffers)) debugger
      // gl.drawBuffers(buf.drawBuffers) // part of test to restore internal state after binding
    }
  }
  return buf
}

function getBoundTextures(gl, currentActive) {
  var maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
  const textures = new Array(maxTextureUnits)
  for (var i = 0; i < maxTextureUnits; ++i) {
    gl.activeTexture(gl.TEXTURE0 + i)
    let type = null
    let tx = null
    if (tx = gl.getParameter(gl.TEXTURE_BINDING_2D)) {
      type = gl.TEXTURE_2D
    } else if (tx = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP)) {
      type = gl.TEXTURE_CUBE_MAP
    } else if (tx = gl.getParameter(gl.TEXTURE_BINDING_3D)) {
      type = gl.TEXTURE_3D
    } else if (tx = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY)) {
      type = gl.TEXTURE_2D_ARRAY
    }
    textures[i] = type ? [type, tx] : null
  }
  gl.activeTexture(currentActive)
  return textures
}

function restoreTextureBindings(gl, textures, currentActive) {
  for (var i = 0; i < 16; i++) {
    const currTex = gl.sgl.textures[i]
    const tex = textures[i]

    if (DEV_MODE && tex === undefined) throw new Error('Undefined texture, make sure the array is of correct size')

    if (currTex === tex) continue // shallow test should work
    if (currTex && tex && tex[0] === currTex[0] && tex[1] === currTex[1]) {
      // in case the above is a deep copy not shallow
      continue
    }

    gl.activeTexture(gl.TEXTURE0 + i)
    gl.bindTexture(tex ? tex[0] : gl.TEXTURE_2D, tex ? tex[1] : null)
  }
  gl.activeTexture(currentActive)
}

function setGLState(gl, snapshot) {
  const sgl = snapshot.sgl
  gl.useProgram(sgl.activeProgram)
  gl.bindVertexArray(sgl.vertexArrayBinding) // VAO
  // changing gl.ELEMENT_ARRAY_BUFFER affects bound VAO, we want to only control global level
  // if (sgl.vertexArrayBinding && sgl.elementArrayBufferBinding) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sgl.elementArrayBufferBinding)
  gl.bindBuffer(gl.ARRAY_BUFFER, sgl.arrayBufferBinding)
  gl.bindBuffer(gl.UNIFORM_BUFFER, sgl.uniformBufferBinding) // UBO
  // gl.bindBuffer(s.boundBufferTarget, s.boundBuffer) // binding buffer bound as last,  also must check if VAO was bound, not needed?

  const s = snapshot.state

  restoreGLFeatures(gl, s.feats, gl.state.feats)
  restoreStorei(gl, s.storei, gl.state.storei)
  gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3])
  gl.blendColor(s.blendColor[0], s.blendColor[1], s.blendColor[2], s.blendColor[3])
  gl.blendEquationSeparate(s.blendEquationRgb, s.blendEquationAlpha)
  gl.cullFace(s.cullFaceMode)
  gl.depthFunc(s.depthFunc)
  gl.frontFace(s.frontFace)
  gl.lineWidth(s.lineWidth)
  gl.blendFuncSeparate(s.blendFuncSeparate[0], s.blendFuncSeparate[1], s.blendFuncSeparate[2], s.blendFuncSeparate[3])
  gl.clearColor(s.clearColor[0], s.clearColor[1], s.clearColor[2], s.clearColor[3])
  gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3])
  gl.clearDepth(s.clearDepth)
  gl.depthMask(s.depthMask)
  gl.depthRange(s.depthRange[0], s.depthRange[1])
  gl.polygonOffset(s.polygonOffset[0], s.polygonOffset[1])
  gl.sampleCoverage(s.sampleCoverage[0], s.sampleCoverage[1])
  gl.scissor(s.scissor[0], s.scissor[1], s.scissor[2], s.scissor[3])
  gl.stencilFunc(s.stencilFunc[0], s.stencilFunc[1], s.stencilFunc[2])
  gl.stencilOp(s.stencilOp[0], s.stencilOp[1], s.stencilOp[2])
  gl.stencilMask(s.stencilMask)
  gl.clearStencil(s.clearStencil)
  gl.stencilFuncSeparate(gl.BACK, s.stencilBackFunc[0], s.stencilBackFunc[1], s.stencilBackFunc[2])
  gl.stencilOpSeparate(gl.BACK, s.stencilBackOp[0], s.stencilBackOp[1], s.stencilBackOp[2])
  gl.stencilMaskSeparate(gl.BACK, s.stencilBackMask)

  // gl.bindRenderbuffer(gl.RENDERBUFFER, sgl.renderbuffer.buffer)

  // If gl.FRAMEBUFFER was the last bound, load DRAW_ and READ_ to not become on top
  if (sgl.lastDrawBufferBound === sgl.framebuffer.buffer && sgl.lastReadBufferBound === sgl.framebuffer.buffer) {
    // Update: if gl.FRAMEBUFFER was the last bound then both DRAW_FRAMEBUFFER and READ_FRAMEBUFFER are overwritten
    // bindFramebufferWithReadDrawConfig(gl, gl.DRAW_FRAMEBUFFER, sgl.drawingBuffer)
    // bindFramebufferWithReadDrawConfig(gl, gl.READ_FRAMEBUFFER, sgl.readingBuffer)
  }
  bindFramebufferWithReadDrawConfig(gl, gl.FRAMEBUFFER, sgl.framebuffer)
  // If DRAW_ was bound as last, bind after gl.FRAMEBUFFER
  if (sgl.lastDrawBufferBound === sgl.drawingBuffer.buffer && sgl.lastDrawBufferBound !== sgl.framebuffer.buffer) bindFramebufferWithReadDrawConfig(gl, gl.DRAW_FRAMEBUFFER, sgl.drawingBuffer)
  // If READ_ was bound as last, bind now
  if (sgl.lastReadBufferBound === sgl.readingBuffer.buffer && sgl.lastReadBufferBound !== sgl.framebuffer.buffer) bindFramebufferWithReadDrawConfig(gl, gl.READ_FRAMEBUFFER, sgl.readingBuffer)

  restoreTextureBindings(gl, sgl.textures, s.activeTexture)

  // gl.bindSampler(0, s.samplerBinding)

  // TODO: check these WebGL 2 specific bindings
  // gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s.transformFeedbackBinding)
  // gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, s.transformFeedbackBufferBinding)
  // gl.bufferData(gl.UNIFORM_BUFFER, s.uniformBufferBinding)
  // gl.bindBuffer(gl.COPY_READ_BUFFER, s.copyReadBufferBinding)
  // gl.bindBuffer(gl.COPY_WRITE_BUFFER, s.copyWriteBufferBinding)
  // gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pixelPackBufferBinding)
  // gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, s.pixelUnpackBufferBinding)
}

function setGLStatePartial(gl, snapshot) {
  const sgl = snapshot.sgl
  const s = snapshot.state
  if (sgl) {
    sgl.activeProgram && gl.useProgram(sgl.activeProgram)
    if (sgl.vertexArrayBinding !== undefined) gl.bindVertexArray(sgl.vertexArrayBinding) // VAO
    if (sgl.vertexArrayBinding !== undefined) sgl.elementArrayBufferBinding && gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sgl.elementArrayBufferBinding)
    if (sgl.arrayBufferBinding !== undefined) gl.bindBuffer(gl.ARRAY_BUFFER, sgl.arrayBufferBinding)
    if (sgl.uniformBufferBinding !== undefined) gl.bindBuffer(gl.UNIFORM_BUFFER, sgl.uniformBufferBinding) // UBO

    const activeTexture = (s && s.activeTexture !== undefined) ? s.activeTexture : gl.state.activeTexture
    if (sgl.textures) restoreTextureBindings(gl, sgl.textures, activeTexture)
  }

  if (s.feats) setGLFeaturesPartial(gl, s.feats, gl.state.feats)
  if (s.viewport) gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3])
  if (s.blendColor) gl.blendColor(s.blendColor[0], s.blendColor[1], s.blendColor[2], s.blendColor[3])
  if (s.blendEquationRgb && s.blendEquationAlpha) gl.blendEquationSeparate(s.blendEquationRgb, s.blendEquationAlpha)
  if (s.cullFaceMode !== undefined) gl.cullFace(s.cullFaceMode)
  if (s.depthFunc !== undefined) gl.depthFunc(s.depthFunc)
  if (s.frontFace !== undefined) gl.frontFace(s.frontFace)
  if (s.lineWidth !== undefined) gl.lineWidth(s.lineWidth)
  if (s.blendFuncSeparate) gl.blendFuncSeparate(s.blendFuncSeparate[0], s.blendFuncSeparate[1], s.blendFuncSeparate[2], s.blendFuncSeparate[3])
  if (s.clearColor) gl.clearColor(s.clearColor[0], s.clearColor[1], s.clearColor[2], s.clearColor[3])
  if (s.colorMask) gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3])
  if (s.clearDepth !== undefined) gl.clearDepth(s.clearDepth)
  if (s.depthMask !== undefined) gl.depthMask(s.depthMask)
  if (s.depthRange) gl.depthRange(s.depthRange[0], s.depthRange[1])
  if (s.polygonOffset) gl.polygonOffset(s.polygonOffset[0], s.polygonOffset[1])
  if (s.sampleCoverage) gl.sampleCoverage(s.sampleCoverage[0], s.sampleCoverage[1])
  if (s.scissor) gl.scissor(s.scissor[0], s.scissor[1], s.scissor[2], s.scissor[3])

  if (s.stencilFunc) gl.stencilFunc(s.stencilFunc[0], s.stencilFunc[1], s.stencilFunc[2])
  if (s.stencilOp) gl.stencilOp(s.stencilOp[0], s.stencilOp[1], s.stencilOp[2])
  if (s.stencilMask) gl.stencilMask(s.stencilMask)
  if (s.clearStencil) gl.clearStencil(s.clearStencil)
  if (s.stencilBackFunc) gl.stencilFuncSeparate(gl.BACK, s.stencilBackFunc[0], s.stencilBackFunc[1], s.stencilBackFunc[2])
  if (s.stencilBackOp) gl.stencilOpSeparate(gl.BACK, s.stencilBackOp[0], s.stencilBackOp[1], s.stencilBackOp[2])
  if (s.stencilBackMask) gl.stencilMaskSeparate(gl.BACK, s.stencilBackMask)

  // if (s.renderbuffer) gl.bindRenderbuffer(gl.RENDERBUFFER, s.renderbuffer.buffer)

  if (s.framebuffer && s.lastDrawBufferBound === s.framebuffer.buffer && s.lastReadBufferBound === s.framebuffer.buffer) {
    bindFramebufferWithReadDrawConfig(gl, gl.DRAW_FRAMEBUFFER, s.drawingBuffer)
    bindFramebufferWithReadDrawConfig(gl, gl.READ_FRAMEBUFFER, s.readingBuffer)
  }
  if (s.framebuffer) bindFramebufferWithReadDrawConfig(gl, gl.FRAMEBUFFER, s.framebuffer)
  if (s.drawingBuffer && s.lastDrawBufferBound === s.drawingBuffer.buffer) bindFramebufferWithReadDrawConfig(gl, gl.DRAW_FRAMEBUFFER, s.drawingBuffer)
  if (s.readingBuffer && s.lastReadBufferBound === s.readingBuffer.buffer) bindFramebufferWithReadDrawConfig(gl, gl.READ_FRAMEBUFFER, s.readingBuffer)
}

function bindFramebufferWithReadDrawConfig(gl, fbType, bufferConfig) {
  gl.bindFramebuffer(fbType, bufferConfig.buffer)
  if (bufferConfig.buffer === null) return // if it's null(canvas) it cannot have readBuffer or drawBuffers settings
  if (fbType === gl.FRAMEBUFFER || fbType === gl.DRAW_FRAMEBUFFER) gl.drawBuffers(bufferConfig.drawBuffers)
  if (fbType === gl.FRAMEBUFFER || fbType === gl.READ_FRAMEBUFFER) gl.readBuffer(bufferConfig.readBuffer)
  // DEBUG stuff
  // checkFramebufferDrawAndReadBuffers(fbType, bufferConfig.buffer)
}

// Debug stuff
// function checkFramebufferDrawAndReadBuffers(gl, fbType, fb) {
//   if (fbType === gl.FRAMEBUFFER || fbType === gl.DRAW_FRAMEBUFFER) checkFramebufferDrawBuffers(gl, fbType, fb)
//   if (fbType === gl.FRAMEBUFFER || fbType === gl.READ_FRAMEBUFFER) checkFramebufferReadBuffer(gl, fbType, fb)
// }

// function checkFramebufferDrawBuffers(gl, fbType, fb) {
//   if (!fb.currentDrawBuffers) return

//   const lastDrawbuffer = gl.lastDrawBufferBound
//   gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb)
//   const gldrawBuffers = []
//   for (let i = 0, il = gl.getParameter(gl.MAX_DRAW_BUFFERS); i < il; i++) gldrawBuffers.push(gl.getParameter(gl.DRAW_BUFFER0 + i))
//   const maxDrawBuffers = Math.min(gl.getParameter(gl.MAX_DRAW_BUFFERS), fb.currentDrawBuffers.length)
//   for (let i = 0, il = maxDrawBuffers; i < il; i++) {
//     if (fb.currentDrawBuffers[i] !== gldrawBuffers[i]) {
//       console.log('Draw Buffers mismatch', fb.currentDrawBuffers, gldrawBuffers)
//       break
//     }
//   }
//   gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, lastDrawbuffer)
// }

// function checkFramebufferDrawBuffers2(gl, fb, gldrawBuffers) {
//   if (!fb.currentDrawBuffers) return
//   const maxDrawBuffers = Math.min(gl.getParameter(gl.MAX_DRAW_BUFFERS), gldrawBuffers.length)
//   for (let i = 0, il = maxDrawBuffers; i < il; i++) {
//     if (fb.currentDrawBuffers[i] !== gldrawBuffers[i]) {
//       console.log('Post set draw Buffers mismatch', fb.currentDrawBuffers, gldrawBuffers)
//       break
//     }
//   }
// }

// function checkFramebufferReadBuffer(gl, fb) {
//   const lastReadbuffer = gl.lastReadBufferBound
//   gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb)
//   if (fb.currentReadBuffer !== gl.getParameter(gl.READ_BUFFER)) {
//     console.log('Read Buffers mismatch', fb.currentReadBuffer, gl.getParameter(gl.READ_BUFFER))
//   }
//   gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lastReadbuffer)
// }
