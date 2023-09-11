import { Transform } from 'stream'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { readFile } from 'fs/promises'
import { valid as semverValid } from 'semver'
import {
  functionify,
  processCommit,
  generate
} from './lib/util.js'

const dirname = fileURLToPath(new URL('.', import.meta.url))
// sv-SE is used for yyyy-mm-dd format
const dateFormatter = Intl.DateTimeFormat('sv-SE', {
  timeZone: 'UTC'
})

// function immediate () {
//   return new Promise(resolve => setImmediate(resolve))
// }

async function finalize (context, options) {
  const finalContext = {
    commit: 'commits',
    issue: 'issues',
    date: dateFormatter.format(new Date()),
    ...context
  }

  if (
    typeof finalContext.linkReferences !== 'boolean' &&
    (finalContext.repository || finalContext.repoUrl) &&
    finalContext.commit &&
    finalContext.issue
  ) {
    finalContext.linkReferences = true
  }

  const [
    mainTemplate,
    headerPartial,
    commitPartial,
    footerPartial
  ] = await Promise.all([
    readFile(join(dirname, 'templates/template.hbs'), 'utf-8'),
    readFile(join(dirname, 'templates/header.hbs'), 'utf-8'),
    readFile(join(dirname, 'templates/commit.hbs'), 'utf-8'),
    readFile(join(dirname, 'templates/footer.hbs'), 'utf-8')
  ])
  const finalOptions = {
    groupBy: 'type',
    commitsSort: 'header',
    noteGroupsSort: 'title',
    notesSort: 'text',
    generateOn: commit => semverValid(commit.version),
    finalizeContext: context => context,
    debug: () => {},
    reverse: false,
    includeDetails: false,
    ignoreReverted: true,
    doFlush: true,
    mainTemplate,
    headerPartial,
    commitPartial,
    footerPartial,
    ...options
  }

  if (!finalOptions.transform || typeof finalOptions.transform === 'object') {
    finalOptions.transform = {
      hash: (hash) => {
        if (typeof hash === 'string') {
          return hash.substring(0, 7)
        }
      },
      header: (header) => {
        return header.substring(0, 100)
      },
      committerDate: (date) => {
        if (!date) {
          return
        }

        return dateFormatter.format(new Date(date))
      },
      ...finalOptions.transform
    }
  }

  let generateOn = finalOptions.generateOn

  if (typeof generateOn === 'string') {
    generateOn = (commit) => typeof commit[finalOptions.generateOn] !== 'undefined'
  } else if (typeof generateOn !== 'function') {
    generateOn = () => false
  }

  finalOptions.commitGroupsSort = functionify(finalOptions.commitGroupsSort)
  finalOptions.commitsSort = functionify(finalOptions.commitsSort)
  finalOptions.noteGroupsSort = functionify(finalOptions.noteGroupsSort)
  finalOptions.notesSort = functionify(finalOptions.notesSort)

  return { finalContext, finalOptions, generateOn }
}

/**
 * Creates an async generator of changelog entries from commits.
 * @param {Commit[] | Readable | AsyncIterator<Commit> | AsyncGenerator<Commit>} commits - Commits to generate changelog from.
 * @param {*} context - Context for changelog template.
 * @param {*} options - Options for changelog template.
 * @returns {AsyncGenerator<string>} AsyncGenerator of changelog entries.
 */
export async function * createChangelogAsyncGeneratorFromCommits (commits, context, options) {
  const {
    finalContext,
    finalOptions,
    generateOn
  } = await finalize(context, options)
  let chunk
  let commit
  let keyCommit
  let commitsGroup = []
  let neverGenerated = true
  let result
  let savedKeyCommit
  let firstRelease = true

  for await (chunk of commits) {
    commit = await processCommit(chunk, finalOptions.transform, finalContext)
    keyCommit = commit || chunk

    // previous blocks of logs
    if (finalOptions.reverse) {
      if (commit) {
        commitsGroup.push(commit)
      }

      if (generateOn(keyCommit, commitsGroup, finalContext, finalOptions)) {
        neverGenerated = false
        result = await generate(finalOptions, commitsGroup, finalContext, keyCommit)

        // await immediate()

        if (finalOptions.includeDetails) {
          yield {
            log: result,
            keyCommit
          }
        } else {
          yield result
        }

        commitsGroup = []
      }
    } else {
      if (generateOn(keyCommit, commitsGroup, finalContext, finalOptions)) {
        neverGenerated = false
        result = await generate(finalOptions, commitsGroup, finalContext, savedKeyCommit)

        if (!firstRelease || finalOptions.doFlush) {
          // await immediate()

          if (finalOptions.includeDetails) {
            yield {
              log: result,
              keyCommit: savedKeyCommit
            }
          } else {
            yield result
          }
        }

        firstRelease = false
        commitsGroup = []
        savedKeyCommit = keyCommit
      }

      if (commit) {
        commitsGroup.push(commit)
      }
    }
  }

  if (!finalOptions.doFlush && (finalOptions.reverse || neverGenerated)) {
    return
  }

  result = await generate(finalOptions, commitsGroup, finalContext, savedKeyCommit)

  // await immediate()

  if (finalOptions.includeDetails) {
    yield {
      log: result,
      keyCommit: savedKeyCommit
    }
  } else {
    yield result
  }
}

/**
 * Creates a transform stream which takes commits and outputs changelog entries.
 * @param {*} context - Context for changelog template.
 * @param {*} options - Options for changelog template.
 * @returns {Transform} Transform stream which takes commits and outputs changelog entries.
 */
export function createChangelogWriterStream (context, options) {
  return Transform.from(
    (commits) => createChangelogAsyncGeneratorFromCommits(commits, context, options)
  )
}

/**
 * Create a changelog from commits.
 * @param {Commit[] | Readable | AsyncIterator<Commit> | AsyncGenerator<Commit>} commits - Commits to generate changelog from.
 * @param {*} context - Context for changelog template.
 * @param {*} options - Options for changelog template.
 * @returns {Promise<string>} Changelog string.
 */
export async function createChangelogFromCommits (commits, context, options) {
  const changelogAsyncGenerator = createChangelogAsyncGeneratorFromCommits(commits, context, options)
  let changelog = ''
  let chunk

  for await (chunk of changelogAsyncGenerator) {
    changelog += chunk
  }

  return changelog
}
