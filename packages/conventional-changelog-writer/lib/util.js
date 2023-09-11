import conventionalCommitsFilter from 'conventional-commits-filter'
import Handlebars from 'handlebars'
import semver from 'semver'
import stringify from 'json-stringify-safe'
import { get, set } from './immutable.js'

export function compileTemplates (templates) {
  const {
    mainTemplate: main,
    headerPartial,
    commitPartial,
    footerPartial,
    partials
  } = templates

  if (typeof headerPartial === 'string') {
    Handlebars.registerPartial('header', headerPartial)
  }

  if (typeof commitPartial === 'string') {
    Handlebars.registerPartial('commit', commitPartial)
  }

  if (typeof footerPartial === 'string') {
    Handlebars.registerPartial('footer', footerPartial)
  }

  if (partials) {
    Object.entries(partials).forEach(([name, partial]) => {
      if (typeof partial === 'string') {
        Handlebars.registerPartial(name, partial)
      }
    })
  }

  return Handlebars.compile(main, {
    noEscape: true
  })
}

export function functionify (strOrArr) {
  if (strOrArr && typeof strOrArr !== 'function') {
    return (a, b) => {
      let str1 = ''
      let str2 = ''
      if (Array.isArray(strOrArr)) {
        for (const key of strOrArr) {
          str1 += a[key] || ''
          str2 += b[key] || ''
        }
      } else {
        str1 += a[strOrArr]
        str2 += b[strOrArr]
      }
      return str1.localeCompare(str2)
    }
  } else {
    return strOrArr
  }
}

export function getCommitGroups (groupBy, commits, groupsSort, commitsSort) {
  const commitGroups = []
  const commitGroupsObj = commits.reduce((groups, commit) => {
    const key = commit[groupBy] || ''

    if (groups[key]) {
      groups[key].push(commit)
    } else {
      groups[key] = [commit]
    }

    return groups
  }, {})

  Object.entries(commitGroupsObj).forEach(([title, commits]) => {
    if (title === '') {
      title = false
    }

    if (commitsSort) {
      commits.sort(commitsSort)
    }

    commitGroups.push({
      title,
      commits
    })
  })

  if (groupsSort) {
    commitGroups.sort(groupsSort)
  }

  return commitGroups
}

export function getNoteGroups (notes, noteGroupsSort, notesSort) {
  const retGroups = []

  notes.forEach((note) => {
    const title = note.title
    let titleExists = false

    retGroups.forEach((group) => {
      if (group.title === title) {
        titleExists = true
        group.notes.push(note)
        return false
      }
    })

    if (!titleExists) {
      retGroups.push({
        title,
        notes: [note]
      })
    }
  })

  if (noteGroupsSort) {
    retGroups.sort(noteGroupsSort)
  }

  if (notesSort) {
    retGroups.forEach((group) => {
      group.notes.sort(notesSort)
    })
  }

  return retGroups
}

function cloneCommit (commit) {
  if (!commit || typeof commit !== 'object') {
    return commit
  } else
    if (Array.isArray(commit)) {
      return commit.map(cloneCommit)
    }

  const commitClone = {}
  let value

  for (const key in commit) {
    value = commit[key]

    if (typeof value === 'object') {
      commitClone[key] = cloneCommit(value)
    } else {
      commitClone[key] = value
    }
  }

  return commitClone
}

export async function processCommit (chunk, transform, context) {
  let commit

  try {
    chunk = JSON.parse(chunk) // @todo: ???
  } catch (e) {}

  commit = cloneCommit(chunk)

  if (typeof transform === 'function') {
    commit = await transform(commit, context)

    if (commit) {
      commit.raw = chunk
    }

    return commit
  }

  if (transform) {
    Object.entries(transform).forEach(([path, el]) => {
      let value = get(commit, path)

      if (typeof el === 'function') {
        value = el(value, path)
      } else {
        value = el
      }

      commit = set(commit, path, value)
    })
  }

  commit.raw = chunk

  return commit
}

export function getExtraContext (commits, notes, options) {
  return {
    // group `commits` by `options.groupBy`
    commitGroups: getCommitGroups(options.groupBy, commits, options.commitGroupsSort, options.commitsSort),
    // group `notes` for footer
    noteGroups: getNoteGroups(notes, options.noteGroupsSort, options.notesSort)
  }
}

export async function generate (options, commits, context, keyCommit) {
  const compiled = compileTemplates(options)
  const notes = []
  let filteredCommits

  if (options.ignoreReverted) {
    filteredCommits = conventionalCommitsFilter(commits)
  } else {
    filteredCommits = commits.slice()
  }

  filteredCommits = filteredCommits.map((commit) => ({
    ...commit,
    notes: commit.notes.map((note) => {
      const commitNote = {
        ...note,
        commit
      }

      notes.push(commitNote)

      return commitNote
    })
  }))

  context = {
    ...context,
    ...keyCommit,
    ...getExtraContext(filteredCommits, notes, options)
  }

  if (keyCommit && keyCommit.committerDate) {
    context.date = keyCommit.committerDate
  }

  if (context.version && semver.valid(context.version)) {
    context.isPatch = context.isPatch || semver.patch(context.version) !== 0
  }

  context = await options.finalizeContext(context, options, filteredCommits, keyCommit, commits)
  options.debug('Your final context is:\n' + stringify(context, null, 2))

  return compiled(context)
}
