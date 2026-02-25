import { describe, it, expect } from 'vitest'
import { diffNewItems } from './trigger.js'

describe('trigger', () => {
  describe('diffNewItems', () => {
    it('returns all items when old is null', () => {
      const result = diffNewItems(null, 'a\nb\nc')
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('returns only new items', () => {
      const result = diffNewItems('a\nb', 'a\nb\nc\nd')
      expect(result).toEqual(['c', 'd'])
    })

    it('returns empty when no new items', () => {
      const result = diffNewItems('a\nb', 'a\nb')
      expect(result).toEqual([])
    })

    it('handles empty new output', () => {
      const result = diffNewItems('a\nb', '')
      expect(result).toEqual([])
    })

    it('filters empty lines', () => {
      const result = diffNewItems(null, 'a\n\nb\n\n')
      expect(result).toEqual(['a', 'b'])
    })
  })
})
