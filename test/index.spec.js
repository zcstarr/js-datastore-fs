/* @flow */
/* eslint-env mocha */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect
const path = require('path')
const promisify = require('util').promisify
const mkdirp = require('mkdirp')
const rimraf = promisify(require('rimraf'))
const fs = require('fs')
const fsReadFile = promisify(require('fs').readFile)
const Key = require('interface-datastore').Key
const utils = require('interface-datastore').utils
const ShardingStore = require('datastore-core').ShardingDatastore
const sh = require('datastore-core').shard

const FsStore = require('../src')

describe('FsDatastore', async () => {
  describe('construction', async () => {
    it('defaults - folder missing', () => {
      const dir = utils.tmpdir()
      expect(
        () => new FsStore(dir)
      ).to.not.throw()
    })

    it('defaults - folder exists', () => {
      const dir = utils.tmpdir()
      mkdirp.sync(dir)
      expect(
        () => new FsStore(dir)
      ).to.not.throw()
    })

    it('createIfMissing: false - folder missing', () => {
      const dir = utils.tmpdir()
      expect(
        () => new FsStore(dir, { createIfMissing: false })
      ).to.throw()
    })

    it('errorIfExists: true - folder exists', () => {
      const dir = utils.tmpdir()
      mkdirp.sync(dir)
      expect(
        () => new FsStore(dir, { errorIfExists: true })
      ).to.throw()
    })
  })

  it('_encode and _decode', () => {
    const dir = utils.tmpdir()
    const fs = new FsStore(dir)

    expect(
      fs._encode(new Key('hello/world'))
    ).to.eql({
      dir: path.join(dir, 'hello'),
      file: path.join(dir, 'hello', 'world.data')
    })

    expect(
      fs._decode(fs._encode(new Key('hello/world/test:other')).file)
    ).to.eql(
      new Key('hello/world/test:other')
    )
  })

  it('sharding files', async () => {
    const dir = utils.tmpdir()
    const fstore = new FsStore(dir)
    const shard = new sh.NextToLast(2)
    await ShardingStore.create(fstore, shard)

    const file = await fsReadFile(path.join(dir, sh.SHARDING_FN))
    expect(file.toString()).to.be.eql('/repo/flatfs/shard/v1/next-to-last/2\n')

    const readme = await fsReadFile(path.join(dir, sh.README_FN))
    expect(readme.toString()).to.be.eql(sh.readme)
    await rimraf(dir)
  })

  it('query', async () => {
    const fs = new FsStore(path.join(__dirname, 'test-repo', 'blocks'))
    let res = []
    for await (const q of fs.query({})) {
      res.push(q)
    }
    expect(res).to.have.length(23)
  })

  it('interop with go', async () => {
    const repodir = path.join(__dirname, '/test-repo/blocks')
    const fstore = new FsStore(repodir)
    const key = new Key('CIQGFTQ7FSI2COUXWWLOQ45VUM2GUZCGAXLWCTOKKPGTUWPXHBNIVOY')
    const expected = fs.readFileSync(path.join(repodir, 'VO', key.toString() + '.data'))
    const flatfs = await ShardingStore.open(fstore)
    let res = await flatfs.get(key)
    let queryResult = flatfs.query({})
    let results = []
    for await (const result of queryResult) results.push(result)
    expect(results).to.have.length(23)
    expect(res).to.be.eql(expected)
  })

  describe('interface-datastore', () => {
    const dir = utils.tmpdir()

    require('interface-datastore/src/tests')({
      setup: () => {
        return new FsStore(dir)
      },
      teardown: () => {
        return rimraf(dir)
      }
    })
  })

  describe('interface-datastore (sharding(fs))', () => {
    const dir = utils.tmpdir()

    require('interface-datastore/src/tests')({
      setup: () => {
        const shard = new sh.NextToLast(2)
        return ShardingStore.createOrOpen(new FsStore(dir), shard)
      },
      teardown: () => {
        return rimraf(dir)
      }
    })
  })
})
