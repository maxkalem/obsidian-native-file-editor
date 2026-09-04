;; Clojure: maps, threading, destructuring, defn.
(ns nfe.scanner
  (:require [clojure.string :as str]))

(def limit (* 5 1024 1024))

(defn tags [text]
  (map second (re-seq #"#([\w-]+)" text)))

(defn group-by-tag [notes]
  (->> notes
       (remove #(> (:size %) limit))
       (mapcat (fn [{:keys [tags] :as n}] (map vector tags (repeat n))))
       (reduce (fn [acc [t n]] (update acc t (fnil conj []) n)) {})))

(println (group-by-tag [{:path "a.md" :size 12 :tags ["x" "y"]}]))
