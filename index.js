/**
 this module provides fulltext parsing using the pelias/parser module.
 see: https://github.com/pelias/parser

 'pelias parser' provides the following fields:
 'name',
 'housenumber', 'street', 'postcode',
 'locality', 'region', 'country',
 'admin'
 **/
import AddressParser from "pelias-parser/parser/AddressParser";
import Tokenizer from "pelias-parser/tokenization/Tokenizer";
import Solution from "pelias-parser/solver/Solution";
import _ from "lodash";

const parser = new AddressParser();

function cutAdmin (parsedText) {
  if (parsedText.admin) {
    let width = parsedText.subject.length;
    let cut = parsedText.admin.substring(0, width)
    if (cut === parsedText.subject) {
      parsedText.admin = _.trim(parsedText.admin.substring(width), ', ')
      if (!parsedText.admin.length) {
        delete parsedText.admin
      }
    }
  }
}

export const parse = function (text) {
  // TODO: normalize unicode marks
  // let text = unicode.normalize(raw.text)

  // TODO: truncate text to 140 chars (should happen at the caller)

  // tokenize text
  const tokenizer = new Tokenizer(text)
  parser.classify(tokenizer)
  parser.solve(tokenizer)

  // TODO: Unsure about snipped "debug" section

  // only use the first solution generated
  // @todo: we could expand this in the future to accommodate more solutions
  let solution = new Solution()
  if (tokenizer.solution.length) { solution = tokenizer.solution[0] }

  // 1. map the output of the parser in to parsedText
  let parsedText = { subject: undefined }

  solution.pair.forEach(p => {
    let field = p.classification.label

    // handle intersections
    if (field === 'street') {
      field = (!parsedText.street) ? 'street' : 'cross_street'
    }

    // set field
    parsedText[field] = p.span.body
  })

  // 2. find any unclassified characters:

  // generate a classification mask, eg:
  // 'Foo Cafe 10 Main St London 10010 Earth'
  // '    VVVV NN SSSSSSS AAAAAA PPPPP      '
  let mask = solution.mask(tokenizer)

  // the entire input text as seen by the parser with any postcode classification(s) removed
  let body = tokenizer.span.body.split('')
    .map((c, i) => (mask[i] !== 'P') ? c : ' ')
    .join('')

  // scan through the input text and 'bucket' characters in to one of two buckets:
  // prefix: all unparsed characters that came before any parsed fields
  // postfix: all characters from the first admin field to the end of the string

  // set cursor to the first classified character from selected classes
  let cursor = mask.search(/[NSAP]/)

  // >> solution includes venue classification
  // set cursor after the venue name
  if (mask.includes('V')) { cursor = mask.lastIndexOf('V') +1 }

  if (cursor === -1) { cursor = body.length; }
  let prefix = _.trim(body.substring(0, cursor), ' ,')

  // solution includes address classification
  // set cursor after the last classified address character
  if (mask.search(/[NS]/) > -1) {
    cursor = Math.max(mask.lastIndexOf('N'), mask.lastIndexOf('S')) + 1
  }
    // solution includes admin classification
  // set cursor to the first classified admin character
  else if( mask.includes('A') ){ cursor = mask.indexOf('A') }
    // >> solution includes venue classification
  // set cursor after the venue name
  else if (mask.includes('V')) { cursor = mask.lastIndexOf('V') + 1 }
  // else set cursor to end-of-text
  else { cursor = body.length }
  let postfix = _.trim(body.substring(cursor), ' ,')

  // clean up spacing around commas
  prefix = prefix.split(/[,\n\t]/).join(', ')
  postfix = postfix.split(/[,\n\t]/).join(', ')

  // handle the case where 'parsedText' is completely empty
  // ie. the parser was not able to classify anything at all
  // note: this is common for venue names
  // note: length == 1 accounts for 'subject'
  if (Object.keys(parsedText).length === 1) {
    if (prefix.length && !postfix.length) {
      // if the prefix contains a comma
      // then only use the first part for the prefix for the
      // name and use the remaining tokens for the postfix
      // eg. 'Friendly Cafe, Footown'
      // note: this is how the old 'naive' parser worked
      let split = prefix.split(',')
      if (split.length > 1) {
        prefix = split[0].trim()
        postfix = split.slice(1).join(', ').trim()
      }
    }
  }

  // squash multiple adjacent whitespace characters into a single space
  prefix = prefix.replace(/\s+/g, ' ').trim()
  postfix = postfix.replace(/\s+/g, ' ').trim()

  // 3. store the unparsed characters in fields which can be used for querying
  // if (prefix.length) { parsedText.name = prefix; }
  // FIXME: This seems to assume western ordering
  if (postfix.length) { parsedText.admin = postfix }

  // 4. set 'subject', this is the text which will target the 'name.*'
  // fields in elasticsearch queries

  // an address query
  if (!_.isEmpty(parsedText.housenumber) && !_.isEmpty(parsedText.street)) {
    parsedText.subject = `${parsedText.housenumber} ${parsedText.street}`
  }
  // an intersection query
  else if (!_.isEmpty(parsedText.street) && !_.isEmpty(parsedText.cross_street)) {
    parsedText.subject = `${parsedText.street} & ${parsedText.cross_street}`
  }
  // a street query
  else if (!_.isEmpty(parsedText.street)) {
    parsedText.subject = parsedText.street
  }
  // query with a $prefix such as a venue query
  else if (!_.isEmpty(prefix)){
    parsedText.subject = prefix
  }
  // a postcode query
  else if (!_.isEmpty(parsedText.postcode)) {
    parsedText.subject = parsedText.postcode
  }
  // a locality query
  else if (!_.isEmpty(parsedText.locality)) {
    parsedText.subject = parsedText.locality

    // remove the locality name from $admin
    cutAdmin(parsedText)
  }
  // a region query
  else if (!_.isEmpty(parsedText.region)) {
    parsedText.subject = parsedText.region

    // remove the region name from $admin
    cutAdmin(parsedText)
  }
  // a country query
  else if (!_.isEmpty(parsedText.country)) {
    parsedText.subject = parsedText.country

    // remove the country name from $admin
    cutAdmin(parsedText);
  }

  // unknown query type
  else {
    parsedText.subject = tokenizer.span.body;
  }

  return parsedText
}
