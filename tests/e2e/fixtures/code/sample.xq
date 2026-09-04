xquery version "3.1";
(: XQuery: FLWOR, functions, namespaces, constructors. :)
declare namespace nfe = "http://example.com/nfe";
declare variable $limit := 5 * 1024 * 1024;

declare function nfe:large($n as element(note)) as xs:boolean {
  xs:integer($n/@size) gt $limit
};

<tags>{
  for $n in doc("notes.xml")//note[not(nfe:large(.))]
  for $t in $n/tag
  group by $tag := string($t)
  order by count($n) descending
  return <tag name="{$tag}" notes="{count($n)}"/>
}</tags>
