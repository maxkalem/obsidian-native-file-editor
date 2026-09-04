# Gherkin: feature, background, scenario outline, table.
Feature: Opening text files
  Files open in preview first and switch to an editor on request.

  Background:
    Given the plugin is enabled
    And "Initial mode" is "Preview first"

  Scenario: a small file opens as a preview
    When I open "sample.ts"
    Then the head bar shows "TypeScript"
    And the body is a preview

  Scenario Outline: large files ask before editing
    When I open a file of <size> MB
    And I press "Edit"
    Then I see the "<dialog>" dialog

    Examples:
      | size | dialog     |
      | 6    | Large file |
      | 12   | Large file |
