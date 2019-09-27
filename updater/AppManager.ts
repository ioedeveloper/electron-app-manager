import os, { release } from 'os'
import Cache from './repositories/Cache'
import { IFetchOptionsReleaseList, IRemoteRepository, IFetchOptionsRelease } from './api/IRepository'
import { getRepository } from './repositories'
import { compareVersions } from './util'
import { IRelease, IInvalidRelease } from './api/IRelease'
import semver from 'semver'


export interface IAppManagerOptions {
  repository?: string;
  cacheDir?: string;
}

export interface IUpdateInfo {
  updateAvailable : boolean,
  source: string,
  latest: IRelease | null
}

export const LOGLEVEL = {
  NORMAL: 0,
  WARN: 1,
  VERBOSE: 2
}

export default class AppManager {

  loglevel = LOGLEVEL.NORMAL;
  remote?: IRemoteRepository;
  cache?: Cache;

  constructor({
    repository,
    cacheDir
  } : IAppManagerOptions){

    if (repository) {
      this.remote = getRepository(repository)
    }

    if (cacheDir) {
      this.cache = new Cache(cacheDir)
    }

  }

  get cacheDir() : string | undefined {
    if (!this.cache) return undefined
    return this.cache.cacheDirPath
  }

  private log(loglevel = LOGLEVEL.NORMAL, message: string, ...optionalParams: any[]) {
    if (this.loglevel >= loglevel) {
      console.log(message, optionalParams)
    }
  }

  /**
   * Clears the cache
   */
  public async clearCache() : Promise<void> {
    if (!this.cache) return
    return this.cache.clear()
  }

  /**
   * Returns all cached releases
   */
  private async getReleasesCached(options? : IFetchOptionsReleaseList) : Promise<Array<IRelease | IInvalidRelease>> {
    if (!this.cache) {
      console.warn('Accessing an uninitialized Cache: getReleases()')
      return []
    }
    // TODO handle searchPaths
    return this.cache.getReleases()
  }

  /**
   * Returns all remote releases
   */
  private async getReleasesRemote(options? : IFetchOptionsReleaseList) : Promise<Array<IRelease | IInvalidRelease>> {
    if (!this.remote) {
      console.warn('Accessing an uninitialized Repository: getReleases()')
      return []
    }
    return this.remote.getReleases()
  }

  /**
   * Returns all releases. Combines cached and remote releases
   * @param fetchOptions 
   */
  public async getReleases({
    sort = true,
    onlyCache = false,
    onlyRemote = false,
    version = undefined,
    filterInvalid = true
  } : IFetchOptionsReleaseList) : Promise<Array<IRelease | IInvalidRelease>> {

    const cachedReleases = onlyRemote ?  [] : await this.getReleasesCached()
    const remoteReleases = onlyCache ? [] : await this.getReleasesRemote()

    let releases = [
      ...cachedReleases,
      ...remoteReleases
    ]

    if(version) {
      releases = releases.filter(release => {
        if (!('version' in release)) {
          return false
        }
        let coercedVersion = semver.coerce(release.version)
        let release_version = coercedVersion ? coercedVersion.version : release.version
        return semver.satisfies(release_version, version)
      })
    }

    const invalid = releases.filter(release => ('error' in release))
    if (invalid.length > 0) {
      this.log(LOGLEVEL.WARN, `detected ${invalid.length} corrupted releases found`)
      this.log(LOGLEVEL.VERBOSE, invalid.map(r => r.error).join('\n\n'))
    }

    if (filterInvalid) {
      releases = releases.filter(release => !('error' in release))
    }

    if (sort) {
      return releases.sort(compareVersions)
    }

    return releases
  }

  public async getLatest({
    onlyCache = false,
    onlyRemote = false,
    version = undefined,
  } : IFetchOptionsRelease) : Promise<IRelease | undefined> {

    const releases = await this.getReleases({
      onlyCache,
      onlyRemote,
      version,
      filterInvalid: true,
      sort: true
    }) as Array<IRelease>

    if (releases.length > 0) {

      // handle the common case of remote and local  (cached)
      // having same version. in this case we want to always return cached
      if (releases.length > 1) {
        if (releases[0].version === releases[1].version) {
          if(releases[0].remote && !releases[1].remote) {
            return releases[1]
          }
        }
      }

      // TODO ? extendWithMetdata()
      return releases[0]
    }
    
    return undefined
  }

  public async load(){}

  public async download(release : IRelease, downloadOptions : IDownloadOptions = {} ) {

  }

  /*
  async checkForUpdates() : Promise<IUpdateInfo> {

    if(this.isElectron) {
      return this.checkForElectronUpdates()
    }
    // else: ui / app updater
    const latest = await this.getLatest()
    if(latest === null){
      return {
        updateAvailable: false,
        source: '',
        latest: null
      }
    }

    // latest release is not from remote -> no updates necessary
    if(latest.repository === SOURCES.CACHE || latest.repository === SOURCES.HOTLOADER){
      return {
        updateAvailable: false,
        source: latest.repository,
        latest: latest,
      }
    }

    return {
      updateAvailable: true,
      source: latest.repository,
      latest
    }
  }
  */

}
