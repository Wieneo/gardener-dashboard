//
// SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

'use strict'

const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const { promisify } = require('util')
const readFile = promisify(fs.readFile)
const { DockerfileParser } = require('dockerfile-ast')

/* Nodejs release schedule (see https://nodejs.org/en/about/releases/) */
const activeNodeReleases = {
  18: {
    endOfLife: new Date('2025-04-30T23:59:59Z')
  },
  19: {
    endOfLife: new Date('2023-06-01T23:59:59Z')
  },
  20: {
    endOfLife: new Date('2026-04-30T23:59:59Z')
  }
}

async function getDashboardDockerfile () {
  const filename = path.join(__dirname, '..', '..', 'Dockerfile')
  const data = await readFile(filename, 'utf8')
  return DockerfileParser.parse(data)
}

describe('dockerfile', function () {
  it('should have the same alpine base image as the corresponding node image', async function () {
    const dashboardDockerfile = await getDashboardDockerfile()

    expect(dashboardDockerfile.getFROMs()).toHaveLength(6)
    const buildStages = _
      .chain(dashboardDockerfile.getFROMs())
      .map(from => [from.getBuildStage(), from])
      .fromPairs()
      .value()
    const imageTag = buildStages.builder.getImageTag()
    const [, nodeRelease] = /^(\d+(?:\.\d+)?(?:\.\d+)?)-alpine/.exec(imageTag) || []
    expect(_.keys(activeNodeReleases)).toContain(nodeRelease)
    const endOfLife = activeNodeReleases[nodeRelease].endOfLife
    // Node release ${nodeRelease} reached end of life. Update node base image in Dockerfile.
    expect(endOfLife.getTime()).toBeGreaterThan(Date.now())
    expect(buildStages['node-scratch'].getImage()).toBe('scratch')
    for (const key of ['dashboard', 'dashboard-terminal-bootstrapper']) {
      expect(buildStages[key].getImage()).toBe('node-scratch')
    }
  })
})
