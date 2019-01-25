import { EventEmitter } from 'events'
import { IRemoteRepository } from './api/IRepository'
import GithubRepo from './repositories/Github'
import AzureRepo from './repositories/Azure'
import Cache from './repositories/Cache'
import { IRelease, IReleaseExtended } from './api/IRelease'
import fs from 'fs'
import path from 'path'
import semver from 'semver';
import HotLoader from './HotLoader';

interface IUpdaterOptions {
  repository: string;
  auto?: boolean;
  intervalMins?: number,
  cacheDir?: string;
  downloadDir?: string;
  modifiers? : { [key : string] : Function }
  filter?: Function
}

export default class AppManager extends EventEmitter{
  
  remote: IRemoteRepository;
  cache: Cache;
  checkHandler: any; // IntervalHandler
  
  /**
   *
   */
  constructor({ repository, auto = true, intervalMins = 15, cacheDir, modifiers, filter } : IUpdaterOptions) {
    super();

    if(repository.startsWith('https://github.com/')) {
      this.remote = new GithubRepo(repository)
    }
    else if(repository.includes('blob.core.windows.net')){

      // FIXME check that only host name provided or parse
      repository += '/builds?restype=container&comp=list'

      if(modifiers){
        let mod = (release : IRelease) => {
          let result : {[key:string] : any} = { }
          for(var m in modifiers){
            result[m] = modifiers[m](release)
          }
          return result
        }
        this.remote = new AzureRepo(repository, {
          onReleaseParsed: mod,
          filter
        })      
      } else {
        this.remote = new AzureRepo(repository)
      }
    }
    else {
      throw new Error('No repository strategy found for url: ' + repository)
    }

    if(cacheDir){
      this.cache = new Cache(cacheDir)
    } else {
      this.cache = new Cache(__dirname)
    }

    this.checkForUpdates = this.checkForUpdates.bind(this)

    if(auto){
      if (intervalMins <= 5 || intervalMins > (24 * 60)) {
        throw new Error(`Interval ${intervalMins} (min) is unreasonable or not within api limits`)
      }
      let intervalMs = intervalMins * 60 * 1000
      // FIXME this.startUpdateRoutine(intervalMs)
    }

  }

  get repository() : string{
    return this.remote.repositoryUrl
  }

  private startUpdateRoutine(intervalMs : number){
    if (this.checkHandler) {
      throw new Error('Update routine was started multiple times')
    }
    let errorCounter = 0

    const check = async () => {
      let latest = await this.checkForUpdates()
      if (latest && latest.version) {
        console.log('update found: downloading ', latest.version);
        try {
          let download = await this.download(latest)

        } catch (error) {
          errorCounter++
          console.error(error)
        }
      }
    }

    check()
    this.checkHandler = setInterval(check, intervalMs)
  }

  async checkForUpdates() : Promise<IRelease | IReleaseExtended | null> {
    const latestCached = await this.cache.getLatest()
    const latestRemote = await this.remote.getLatest()
    if(!latestCached){
      return latestRemote // null || release
    }
    if(!latestRemote){
      return null
    }
    if(semver.gt(latestRemote.version, latestCached.version)){
      return latestRemote
    }
    return null 
  }

  async getLatestCached(){
    return this.cache.getLatest()
  }

  async getLatestRemote(){
    return await this.remote.getLatest()
  }

  async getLatest() : Promise<IRelease | null>{
    const latestCached = await this.cache.getLatest()
    const latestRemote = await this.remote.getLatest()

    const versionCache = latestCached  ? latestCached.version : '0.0.0'
    const versionRemote = latestRemote ? latestRemote.version : '0.0.0'

    if(semver.gt(versionCache, versionRemote)){
      return latestCached
    }

    return latestRemote
  }

  async download(release : IRelease, {writePackageData = true, writeDetachedMetadata = true} = {} ){

    let pp = 0;
    let onProgress = (p : number) => {
      let pn = Math.floor(p * 100);
      if (pn > pp) {
        pp = pn;
        // console.log(`downloading update..  ${pn}%`)
        this.emit('update-progress', release, pn);
      }
    }
    const packageData = await this.remote.download(release, onProgress)
    const location = path.join(this.cache.cacheDirPath, release.fileName)

    if(writePackageData){
      if(writeDetachedMetadata){
        const detachedMetadataPath = path.join(this.cache.cacheDirPath, release.fileName + '.metadata.json')
        fs.writeFileSync(detachedMetadataPath, JSON.stringify(release, null, 2))
      }
      // TODO patch package metadata if it doesn't exist
      fs.writeFileSync(location, packageData)

    } else{
      this.emit('update-downloaded', release)

      return {
        ...release,
        location: 'memory',
        data: packageData
      }
    }

    this.emit('update-downloaded', release)

    return {
      ...release,
      location
    }
  }

  async hotLoad(release : IRelease | undefined){
    const hotLoader = new HotLoader(this)
    // load app to memory and serve from there
    const hotLoaderUrl = await hotLoader.load(release)
    return hotLoaderUrl
  }

}
