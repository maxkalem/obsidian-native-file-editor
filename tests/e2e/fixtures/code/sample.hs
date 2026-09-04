-- Haskell: data types, type classes, Maybe, folds.
{-# LANGUAGE OverloadedStrings #-}
module Scanner (Note (..), groupByTag, describe) where

import qualified Data.Map.Strict as M

data Note = Note { path :: FilePath, tags :: [String], size :: Int } deriving (Show, Eq)

limit :: Int
limit = 5 * 1024 * 1024

groupByTag :: [Note] -> M.Map String [Note]
groupByTag = foldr insert M.empty . filter ((<= limit) . size)
  where insert n m = foldr (\t -> M.insertWith (++) t [n]) m (tags n)

describe :: Int -> String
describe 0 = "no tags"
describe n | n > 100 = "many tags: " ++ show n
           | otherwise = show n ++ " tags"
