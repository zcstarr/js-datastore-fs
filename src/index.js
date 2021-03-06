/* @flow */
'use strict'

/* :: import type {Batch, Query, QueryResult, Callback} from 'interface-datastore' */

const fs = require('graceful-fs')
const glob = require('glob')
const mkdirp = require('mkdirp')
const promisify = require('util').promisify
const writeFile = promisify(require('fast-write-atomic'))
const path = require('path')

const filter = require('interface-datastore').utils.filter
const take = require('interface-datastore').utils.take
const map = require('interface-datastore').utils.map
const sortAll = require('interface-datastore').utils.sortAll
const IDatastore = require('interface-datastore')

const asyncMkdirp = promisify(require('mkdirp'))
const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsUnlink = promisify(fs.unlink)

const Key = IDatastore.Key
const Errors = IDatastore.Errors

/* :: export type FsInputOptions = {
  createIfMissing?: bool,
  errorIfExists?: bool,
  extension?: string
}

type FsOptions = {
  createIfMissing: bool,
  errorIfExists: bool,
  extension: string
}
*/

/**
 * A datastore backed by the file system.
 *
 * Keys need to be sanitized before use, as they are written
 * to the file system as is.
 */
class FsDatastore {
  /* :: path: string */
  /* :: opts: FsOptions */

  constructor (location /* : string */, opts /* : ?FsInputOptions */) {
    this.path = path.resolve(location)
    this.opts = Object.assign({}, {
      createIfMissing: true,
      errorIfExists: false,
      extension: '.data'
    }, opts)

    if (this.opts.createIfMissing) {
      this._openOrCreate()
    } else {
      this._open()
    }
  }

  open () /* : void */ {
    this._openOrCreate()
  }

  /**
   * Check if the path actually exists.
   * @private
   * @returns {void}
   */
  _open () {
    if (!fs.existsSync(this.path)) {
      throw new Error(`Datastore directory: ${this.path} does not exist`)
    }

    if (this.opts.errorIfExists) {
      throw new Error(`Datastore directory: ${this.path} already exists`)
    }
  }

  /**
   * Create the directory to hold our data.
   *
   * @private
   * @returns {void}
   */
  _create () {
    mkdirp.sync(this.path, { fs: fs })
  }

  /**
   * Tries to open, and creates if the open fails.
   *
   * @private
   * @returns {void}
   */
  _openOrCreate () {
    try {
      this._open()
    } catch (err) {
      if (err.message.match('does not exist')) {
        this._create()
        return
      }

      throw err
    }
  }

  /**
   * Calculate the directory and file name for a given key.
   *
   * @private
   * @param {Key} key
   * @returns {{string, string}}
   */
  _encode (key /* : Key */) /* : {dir: string, file: string} */ {
    const parent = key.parent().toString()
    const dir = path.join(this.path, parent)
    const name = key.toString().slice(parent.length)
    const file = path.join(dir, name + this.opts.extension)

    return {
      dir: dir,
      file: file
    }
  }

  /**
   * Calculate the original key, given the file name.
   *
   * @private
   * @param {string} file
   * @returns {Key}
   */
  _decode (file /* : string */) /* : Key */ {
    const ext = this.opts.extension
    if (path.extname(file) !== ext) {
      throw new Error(`Invalid extension: ${path.extname(file)}`)
    }

    const keyname = file
      .slice(this.path.length, -ext.length)
      .split(path.sep)
      .join('/')
    return new Key(keyname)
  }

  /**
   * Write to the file system without extension.
   *
   * @param {Key} key
   * @param {Buffer} val
   * @returns {Promise<void>}
   */
  async putRaw (key /* : Key */, val /* : Buffer */) /* : void */ {
    const parts = this._encode(key)
    const file = parts.file.slice(0, -this.opts.extension.length)
    await asyncMkdirp(parts.dir, { fs: fs })
    await writeFile(file, val)
  }

  /**
   * Store the given value under the key.
   *
   * @param {Key} key
   * @param {Buffer} val
   * @returns {Promise<void>}
   */
  async put (key /* : Key */, val /* : Buffer */) /* : void */ {
    const parts = this._encode(key)
    try {
      await asyncMkdirp(parts.dir, { fs: fs })
      await writeFile(parts.file, val)
    } catch (err) {
      throw Errors.dbWriteFailedError(err)
    }
  }

  /**
   * Read from the file system without extension.
   *
   * @param {Key} key
   * @returns {Promise<Buffer>}
   */
  async getRaw (key /* : Key */) /* : void */ {
    const parts = this._encode(key)
    let file = parts.file
    file = file.slice(0, -this.opts.extension.length)
    let data
    try {
      data = await fsReadFile(file)
    } catch (err) {
      throw Errors.notFoundError(err)
    }
    return data
  }

  /**
   * Read from the file system.
   *
   * @param {Key} key
   * @returns {Promise<Buffer>}
   */
  async get (key /* : Key */) /* : void */ {
    const parts = this._encode(key)
    let data
    try {
      data = await fsReadFile(parts.file)
    } catch (err) {
      throw Errors.notFoundError(err)
    }
    return data
  }

  /**
   * Check for the existence of the given key.
   *
   * @param {Key} key
   * @returns {Promise<bool>}
   */
  async has (key /* : Key */) /* : void */ {
    const parts = this._encode(key)
    try {
      await fsAccess(parts.file)
    } catch (err) {
      return false
    }
    return true
  }

  /**
   * Delete the record under the given key.
   *
   * @param {Key} key
   * @returns {Promise<void>}
   */
  async delete (key /* : Key */) /* : void */ {
    const parts = this._encode(key)
    try {
      await fsUnlink(parts.file)
    } catch (err) {
      throw Errors.dbDeleteFailedError(err)
    }
  }

  /**
   * Create a new batch object.
   *
   * @returns {Batch}
   */
  batch () /* : Batch<Buffer> */ {
    const puts = []
    const deletes = []
    return {
      put (key /* : Key */, value /* : Buffer */) /* : void */ {
        puts.push({ key: key, value: value })
      },
      delete (key /* : Key */) /* : void */ {
        deletes.push(key)
      },
      commit: async () /* :  Promise<void> */ => {
        await Promise.all((puts.map((put) => this.put(put.key, put.value))))
        await Promise.all((deletes.map((del) => this.delete(del))))
      }
    }
  }

  /**
   * Query the store.
   *
   * @param {Object} q
   * @returns {Iterable}
   */
  query (q /* : Query<Buffer> */) /* : QueryResult<Buffer> */ {
    // glob expects a POSIX path
    let prefix = q.prefix || '**'
    let pattern = path
      .join(this.path, prefix, '*' + this.opts.extension)
      .split(path.sep)
      .join('/')
    let files = glob.sync(pattern)
    let it
    if (!q.keysOnly) {
      it = map(files, async (f) => {
        const buf = await fsReadFile(f)
        return {
          key: this._decode(f),
          value: buf
        }
      })
    } else {
      it = map(files, f => ({ key: this._decode(f) }))
    }

    if (Array.isArray(q.filters)) {
      it = q.filters.reduce((it, f) => filter(it, f), it)
    }

    if (Array.isArray(q.orders)) {
      it = q.orders.reduce((it, f) => sortAll(it, f), it)
    }

    if (q.offset != null) {
      let i = 0
      it = filter(it, () => i++ >= q.offset)
    }

    if (q.limit != null) {
      it = take(it, q.limit)
    }

    return it
  }

  /**
   * Close the store.
   *
   * @returns {Promise<void>}
   */
  async close () /* : Promise<void> */ { }
}

module.exports = FsDatastore
