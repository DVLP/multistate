# Multistate

**Save** and **restore** the entire state of WebGL easily like in a 2D canvas. Multistate manages the global state only and is not concerned with any properties or content of any textures, buffers, VAOs etc. It also adds cache checks for all the global-state-setting functions to prevent redundant WebGL API calls.

## Handles
1. Global settings including viewport, culling, blending, and stencil.
2. State toggles managed by gl.enable and gl.disable.
3. Options configured with pixelStorei.
4. Currently bound textures.
5. Currently bound framebuffers with their read/draw buffers settings.
6. Current VAO and UBO.
7. Current program.

## Is not concerned with
1. Uniforms and attributes.
2. Any individual buffer settings or content.
3. Any individual texture settings or content.

## Quick start

### Installation

```sh
npm install multistate
```


### Basic usage

```sh
import { enhanceWebGLContext } from 'multistate'

gl = canvas.getContext('webgl2')
enhanceWebGLContext(gl)

// .. run your setup here

// set any global params
gl.viewport(0, 0, 500, 500)

gl.saveState()

// make some changes
gl.viewport(0, 0, 200, 200)
gl.enable(gl.CULL_FACE)

gl.restoreState()

// the viewport is now [0, 0, 500, 500]
console.log(gl.getParameter(gl.VIEWPORT))
// the face culling is now disabled
console.log(gl.isEnabled(gl.CULL_FACE))


```

### Multiple state containers

```sh
// save the container once
const stateContainerA = gl.createState()
const stateContainerB = gl.createState()

// pass the container as a paramter to write to it
gl.saveState(stateContainerA)
gl.restoreState(stateContainerB)
gl.restoreState(stateContainerA)

```
